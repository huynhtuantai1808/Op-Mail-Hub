const express = require('express');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100, // Giới hạn 100 requests mỗi IP
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// API Key authentication middleware
const API_KEYS = new Set(process.env.API_KEYS ? process.env.API_KEYS.split(',') : []);

const authenticateAPIKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key is required' });
  }
  
  if (!API_KEYS.has(apiKey)) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  
  next();
};

// Tạo SMTP transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'stalwart',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100
  });
};

const transporter = createTransporter();

// Verify SMTP connection
transporter.verify((error, success) => {
  if (error) {
    console.error('SMTP connection error:', error);
  } else {
    console.log('SMTP server is ready to take our messages');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    smtp: 'connected'
  });
});

// API endpoint để gửi email đơn
app.post('/api/send', 
  authenticateAPIKey,
  [
    body('from').isEmail().withMessage('Invalid from email'),
    body('to').isEmail().withMessage('Invalid to email'),
    body('subject').notEmpty().withMessage('Subject is required'),
    body('text').optional(),
    body('html').optional()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { from, to, subject, text, html, attachments } = req.body;

    try {
      const mailOptions = {
        from,
        to,
        subject,
        text,
        html,
        attachments
      };

      const info = await transporter.sendMail(mailOptions);
      
      res.json({
        success: true,
        messageId: info.messageId,
        response: info.response
      });
    } catch (error) {
      console.error('Send email error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// API endpoint để gửi email hàng loạt
app.post('/api/send-bulk',
  authenticateAPIKey,
  [
    body('from').isEmail().withMessage('Invalid from email'),
    body('recipients').isArray().withMessage('Recipients must be an array'),
    body('recipients.*.email').isEmail().withMessage('Invalid recipient email'),
    body('subject').notEmpty().withMessage('Subject is required'),
    body('template').notEmpty().withMessage('Template is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { from, recipients, subject, template, templateData } = req.body;
    const results = {
      success: [],
      failed: []
    };

    for (const recipient of recipients) {
      try {
        // Replace template variables
        let emailContent = template;
        const data = { ...templateData, ...recipient.data };
        
        for (const [key, value] of Object.entries(data)) {
          emailContent = emailContent.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }

        const mailOptions = {
          from,
          to: recipient.email,
          subject: subject.replace(/{{(\w+)}}/g, (match, key) => data[key] || match),
          html: emailContent
        };

        const info = await transporter.sendMail(mailOptions);
        
        results.success.push({
          email: recipient.email,
          messageId: info.messageId
        });
      } catch (error) {
        results.failed.push({
          email: recipient.email,
          error: error.message
        });
      }
    }

    res.json({
      total: recipients.length,
      successful: results.success.length,
      failed: results.failed.length,
      results
    });
  }
);

// API endpoint cho báo cáo định kỳ
app.post('/api/send-report',
  authenticateAPIKey,
  [
    body('reportType').notEmpty().withMessage('Report type is required'),
    body('cluster').notEmpty().withMessage('Cluster name is required'),
    body('recipients').isArray().withMessage('Recipients must be an array'),
    body('data').isObject().withMessage('Report data is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { reportType, cluster, recipients, data, subject, from } = req.body;

    try {
      // Tạo HTML report
      const reportHTML = generateReportHTML(reportType, cluster, data);
      
      const mailOptions = {
        from: from || process.env.SMTP_USER,
        to: recipients.join(', '),
        subject: subject || `${reportType} Report - ${cluster} - ${new Date().toLocaleDateString()}`,
        html: reportHTML,
        attachments: data.attachments || []
      };

      const info = await transporter.sendMail(mailOptions);
      
      res.json({
        success: true,
        messageId: info.messageId,
        reportType,
        cluster,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Send report error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Hàm tạo HTML report
function generateReportHTML(reportType, cluster, data) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .metric { background: #f4f4f4; padding: 10px; margin: 10px 0; border-left: 4px solid #4CAF50; }
        .metric-name { font-weight: bold; color: #555; }
        .metric-value { font-size: 1.2em; color: #4CAF50; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #4CAF50; color: white; }
        .footer { text-align: center; padding: 20px; color: #777; font-size: 0.9em; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${reportType} Report</h1>
        <p>Cluster: ${cluster}</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
      </div>
      <div class="content">
        ${Object.entries(data.metrics || {}).map(([key, value]) => `
          <div class="metric">
            <div class="metric-name">${key}</div>
            <div class="metric-value">${value}</div>
          </div>
        `).join('')}
        
        ${data.details ? `
          <h2>Details</h2>
          <table>
            <thead>
              <tr>
                ${Object.keys(data.details[0] || {}).map(key => `<th>${key}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${data.details.map(row => `
                <tr>
                  ${Object.values(row).map(val => `<td>${val}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}
      </div>
      <div class="footer">
        <p>This is an automated report from ${cluster}</p>
      </div>
    </body>
    </html>
  `;
}

// API endpoint để kiểm tra trạng thái queue
app.get('/api/queue/status', authenticateAPIKey, async (req, res) => {
  try {
    const queueInfo = await transporter.verify();
    res.json({
      status: 'operational',
      poolSize: transporter.options.pool,
      maxConnections: transporter.options.maxConnections
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Mail API Gateway running on port ${PORT}`);
  console.log(`SMTP Host: ${process.env.SMTP_HOST}`);
  console.log(`SMTP Port: ${process.env.SMTP_PORT}`);
});

module.exports = app;