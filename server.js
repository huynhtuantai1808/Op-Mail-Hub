const express = require('express');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình Trust Proxy để sửa lỗi ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
const trustProxyValue = (process.env.TRUST_PROXY || 'false').toLowerCase();
if (trustProxyValue === 'true') {
  app.set('trust proxy', true);
  console.log('Express trust proxy enabled');
} else {
  app.set('trust proxy', false);
}

// Middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const secure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const caPath = process.env.SMTP_CA_FILE || process.env.NODE_EXTRA_CA_CERTS || '';
  const allowSelfSigned = (process.env.SMTP_ALLOW_SELF_SIGNED || 'false').toLowerCase() === 'true';

  const tlsOptions = {};

  // Ưu tiên cho phép self-signed nếu được cấu hình
  if (allowSelfSigned) {
    tlsOptions.rejectUnauthorized = false;
    console.warn('SMTP_ALLOW_SELF_SIGNED=true -> SSL verification is DISABLED');
  } else if (caPath) {
    try {
      tlsOptions.ca = [ fs.readFileSync(caPath) ];
      tlsOptions.rejectUnauthorized = true;
      console.log('Using SMTP CA file:', caPath);
    } catch (err) {
      console.error('Failed to read SMTP_CA_FILE:', caPath, err.message);
    }
  }

  const transportOptions = {
    host: process.env.SMTP_HOST || 'stalwart',
    port,
    secure,
    auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    } : undefined,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    tls: tlsOptions,
    debug: true,
    logger: true
  };
  return nodemailer.createTransport(transportOptions);
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
      const mailOptions = { from, to, subject, text, html, attachments };
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

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`Mail API Gateway running on port ${PORT}`);
});

module.exports = app;