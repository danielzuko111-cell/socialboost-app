const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const PROVIDER_API_URL = 'https://mysocialsboost.com/api/v2';
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || '15c176d4487684b0e64e588704e88d93';

// Admin Authentication Credentials
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'danielzuko';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'daniel2004#';

// Exchange rate: 1 USD = 1,650 NGN
const USD_TO_NGN = 1650; 

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

let orders = [];

// Fetch live services
app.get('/api/services', async (req, res) => {
  try {
    const params = new URLSearchParams({
      key: PROVIDER_API_KEY,
      action: 'services'
    });

    const response = await axios.post(PROVIDER_API_URL, params);
    
    if (Array.isArray(response.data)) {
      const markedUpServices = response.data.map(s => {
        const wholesaleRateUSD = parseFloat(s.rate) || 0;
        const wholesaleRateNGN = wholesaleRateUSD * USD_TO_NGN;
        let retailRateNGN = Math.ceil(wholesaleRateNGN * 1.5);

        if (retailRateNGN < 200) {
          retailRateNGN = 200;
        }

        return {
          id: s.service,
          name: s.name,
          category: s.category,
          rate_per_1000: wholesaleRateNGN,
          retail_rate_per_1000: retailRateNGN,
          min: parseInt(s.min) || 100,
          max: parseInt(s.max) || 10000
        };
      });
      return res.json(markedUpServices);
    }

    res.status(500).json({ error: 'Failed to retrieve services from provider.' });
  } catch (error) {
    res.status(500).json({ error: 'Error connecting to provider API.' });
  }
});

// Customer Route: Submit Order & Payment Receipt
app.post('/api/orders/create', upload.single('receipt'), (req, res) => {
  try {
    const { serviceId, serviceName, targetLink, quantity, totalCost } = req.body;

    if (!req.file) return res.status(400).json({ error: 'Payment receipt photo is required' });

    const newOrder = {
      orderId: 'ORD-' + Math.floor(100000 + Math.random() * 900000),
      serviceId,
      serviceName,
      targetLink,
      quantity: parseInt(quantity),
      totalCostNGN: parseInt(totalCost),
      receiptUrl: `/uploads/${req.file.filename}`,
      status: 'Pending Verification',
      createdAt: new Date().toLocaleString()
    };

    orders.unshift(newOrder);
    res.json({ success: true, message: 'Order submitted! Verification pending.', orderId: newOrder.orderId });
  } catch (error) {
    res.status(500).json({ error: 'Server error creating order.' });
  }
});

// Visual Admin Dashboard Interface
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Admin Dashboard - SocialBoost</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0b0f19; color: #fff; padding: 20px; }
        h1 { color: #00e676; text-align: center; }
        .login-box { max-width: 360px; margin: 50px auto; background: #161f30; padding: 24px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
        .login-box h2 { color: #00e676; margin-bottom: 16px; text-align: center; }
        label { font-size: 0.85rem; color: #94a3b8; display: block; margin-top: 10px; }
        input { width: 100%; padding: 12px; margin-top: 6px; background: #0b0f19; border: 1px solid #2a3854; color: #fff; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #00e676; border: none; font-weight: bold; cursor: pointer; border-radius: 6px; margin-top: 20px; color: #0b0f19; font-size: 1rem; }
        .order-card { background: #161f30; padding: 16px; margin-bottom: 16px; border-radius: 10px; border-left: 4px solid #00e676; }
        a { color: #00e676; word-break: break-all; }
        .btn-approve { background: #00e676; color: #0b0f19; padding: 10px 18px; width: auto; font-weight: bold; border-radius: 6px; border: none; cursor: pointer; margin-top: 12px; }
      </style>
    </head>
    <body>
      <div id="login" class="login-box">
        <h2>Admin Login</h2>
        <label>Username</label>
        <input type="text" id="userInput" placeholder="Enter Username" />
        <label>Password</label>
        <input type="password" id="passInput" placeholder="Enter Password" />
        <button onclick="loadOrders()">Login</button>
      </div>

      <div id="dashboard" style="display:none; max-width: 600px; margin: 0 auto;">
        <h1>Admin Order Dashboard</h1>
        <div id="ordersList"></div>
      </div>

      <script>
        let authHeader = '';

        async function loadOrders() {
          const user = document.getElementById('userInput').value;
          const pass = document.getElementById('passInput').value;

          authHeader = 'Basic ' + btoa(user + ':' + pass);

          const res = await fetch('/api/admin/orders', {
            headers: { 'Authorization': authHeader }
          });

          if (res.status === 401) {
            return alert('Invalid Username or Password!');
          }

          const orders = await res.json();
          document.getElementById('login').style.display = 'none';
          document.getElementById('dashboard').style.display = 'block';

          const container = document.getElementById('ordersList');
          if (orders.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#94a3b8; margin-top:30px;">No pending orders.</p>';
            return;
          }

          container.innerHTML = orders.map(o => \`
            <div class="order-card">
              <p><strong>Order ID:</strong> \${o.orderId}</p>
              <p><strong>Service:</strong> \${o.serviceName} (ID: \${o.serviceId})</p>
              <p><strong>Link:</strong> <a href="\${o.targetLink}" target="_blank">\${o.targetLink}</a></p>
              <p><strong>Quantity:</strong> \${o.quantity}</p>
              <p><strong>Amount Paid:</strong> ₦\${o.totalCostNGN}</p>
              <p><strong>Status:</strong> \${o.status}</p>
              <p><strong>Receipt:</strong> <a href="\${o.receiptUrl}" target="_blank">View Payment Receipt</a></p>
              \${o.status === 'Pending Verification' ? \`<button class="btn-approve" onclick="approveOrder('\${o.orderId}')">Approve & Send to Provider</button>\` : ''}
            </div>
          \`).join('');
        }

        async function approveOrder(orderId) {
          if (!confirm('Approve order ' + orderId + '?')) return;
          const res = await fetch('/api/admin/approve-order', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': authHeader
            },
            body: JSON.stringify({ orderId })
          });
          const data = await res.json();
          if (data.success) {
            alert('Order approved! Provider ID: ' + data.providerOrderId);
            loadOrders();
          } else {
            alert('Error: ' + (data.error || 'Failed to approve'));
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Protected Admin API Endpoints Middleware
app.use('/api/admin', (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized: Credentials required' });
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii').split(':');
  const user = credentials[0];
  const pass = credentials[1];

  if (user !== ADMIN_USERNAME || pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized: Invalid username or password' });
  }
  next();
});

app.get('/api/admin/orders', (req, res) => res.json(orders));

app.post('/api/admin/approve-order', async (req, res) => {
  const { orderId } = req.body;
  const order = orders.find(o => o.orderId === orderId);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'Pending Verification') {
    return res.status(400).json({ error: 'Order already processed' });
  }

  try {
    const params = new URLSearchParams({
      key: PROVIDER_API_KEY,
      action: 'add',
      service: order.serviceId,
      link: order.targetLink,
      quantity: order.quantity
    });

    const response = await axios.post(PROVIDER_API_URL, params);

    if (response.data && response.data.order) {
      order.status = 'Approved & Sent to Provider';
      order.providerOrderId = response.data.order;
      res.json({ success: true, message: 'Order approved and sent!', providerOrderId: response.data.order });
    } else {
      order.status = 'API Error';
      res.status(400).json({ error: response.data.error || 'Provider returned an error.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to communicate with provider.' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
