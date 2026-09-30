const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const PROVIDER_API_URL = 'https://mysocialsboost.com/api/v2';
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || '15c176d4487684b0e64e588704e88d93';

// Admin Credentials
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'danielzuko';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'daniel2004#';

const USD_TO_NGN = 1650; 
const DATA_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Data Persistence (File Storage to prevent reset on restarts)
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('Error reading persistence file:', e);
    }
  }
  return { siteVisits: 0, users: [], orders: [] };
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ siteVisits, users, orders }, null, 2));
  } catch (e) {
    console.error('Error saving persistence file:', e);
  }
}

const initialData = loadData();
let siteVisits = initialData.siteVisits || 0;
let users = initialData.users || [];
let orders = initialData.orders || [];
let activeUsersCount = 0;

// Socket.IO Real-time Connection & Presence Tracking
io.on('connection', (socket) => {
  const isAdmin = socket.handshake.query.isAdmin === 'true';

  if (!isAdmin) {
    activeUsersCount++;
    siteVisits++;
    saveData();
    io.emit('active_users_update', { active: activeUsersCount, totalVisits: siteVisits });
  } else {
    socket.emit('active_users_update', { active: activeUsersCount, totalVisits: siteVisits });
  }

  socket.on('disconnect', () => {
    if (!isAdmin && activeUsersCount > 0) {
      activeUsersCount--;
      io.emit('active_users_update', { active: activeUsersCount, totalVisits: siteVisits });
    }
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Authentication Endpoints
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required.' });

  const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(400).json({ error: 'Email already registered.' });

  const newUser = { id: Date.now(), name, email, password };
  users.push(newUser);
  saveData();
  res.json({ success: true, user: { name: newUser.name, email: newUser.email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);

  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
  res.json({ success: true, user: { name: user.name, email: user.email } });
});

// Services Endpoint
app.get('/api/services', async (req, res) => {
  try {
    const params = new URLSearchParams({ key: PROVIDER_API_KEY, action: 'services' });
    const response = await axios.post(PROVIDER_API_URL, params);
    
    if (Array.isArray(response.data)) {
      const markedUpServices = response.data.map(s => {
        const wholesaleRateUSD = parseFloat(s.rate) || 0;
        const wholesaleRateNGN = wholesaleRateUSD * USD_TO_NGN;
        let retailRateNGN = Math.ceil(wholesaleRateNGN * 2.0);

        if (retailRateNGN < 200) retailRateNGN = 200;

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
    res.status(500).json({ error: 'Failed to retrieve services.' });
  } catch (error) {
    res.status(500).json({ error: 'Error connecting to provider API.' });
  }
});

// Order Creation Endpoint
app.post('/api/orders/create', upload.single('receipt'), (req, res) => {
  try {
    const { customerName, customerEmail, serviceId, serviceName, targetLink, quantity, totalCost } = req.body;
    const formattedTime = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
    const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;

    const newOrder = {
      orderId: 'ORD-' + Math.floor(100000 + Math.random() * 900000),
      customerName: customerName || 'Guest User',
      customerEmail: customerEmail || 'N/A',
      serviceId,
      serviceName,
      targetLink,
      quantity: parseInt(quantity),
      totalCostNGN: parseInt(totalCost),
      receiptUrl: receiptPath,
      verificationType: receiptPath ? 'Direct Upload' : 'WhatsApp Verification',
      status: 'Pending Verification',
      createdAt: formattedTime
    };

    orders.unshift(newOrder);
    saveData();
    res.json({ success: true, message: 'Order submitted!', orderId: newOrder.orderId });
  } catch (error) {
    res.status(500).json({ error: 'Server error creating order.' });
  }
});

// Admin Control Panel Route
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
        .stats-grid { display: flex; gap: 15px; margin: 20px 0; }
        .stats-box { flex: 1; background: #161f30; padding: 16px; border-radius: 12px; text-align: center; border: 1px solid #2a3854; }
        .stats-box h3 { color: #00e676; font-size: 2rem; margin: 8px 0; }
        .login-box { max-width: 360px; margin: 50px auto; background: #161f30; padding: 24px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
        .login-box h2 { color: #00e676; margin-bottom: 16px; text-align: center; }
        label { font-size: 0.85rem; color: #94a3b8; display: block; margin-top: 10px; }
        input { width: 100%; padding: 12px; margin-top: 6px; background: #0b0f19; border: 1px solid #2a3854; color: #fff; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #00e676; border: none; font-weight: bold; cursor: pointer; border-radius: 6px; margin-top: 20px; color: #0b0f19; font-size: 1rem; }
        .order-card { background: #161f30; padding: 16px; margin-bottom: 16px; border-radius: 10px; border-left: 4px solid #00e676; }
        a { color: #00e676; word-break: break-all; }
        .btn-group { display: flex; gap: 10px; margin-top: 12px; }
        .btn-approve { background: #00e676; color: #0b0f19; padding: 10px 18px; font-weight: bold; border-radius: 6px; border: none; cursor: pointer; }
        .btn-decline { background: #ef4444; color: #ffffff; padding: 10px 18px; font-weight: bold; border-radius: 6px; border: none; cursor: pointer; }
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
        <h1>Admin Control Panel</h1>
        
        <div class="stats-grid">
          <div class="stats-box">
            <p style="color: #94a3b8; text-transform: uppercase; font-size: 0.8rem;">Live Active Users</p>
            <h3 id="liveCount">0</h3>
            <p style="font-size: 0.8rem; color: #64748b;">Currently on site</p>
          </div>
          <div class="stats-box">
            <p style="color: #94a3b8; text-transform: uppercase; font-size: 0.8rem;">Total Traffic</p>
            <h3 id="visitCount">0</h3>
            <p style="font-size: 0.8rem; color: #64748b;">All-time Visits</p>
          </div>
        </div>

        <h2 style="margin-bottom: 15px; font-size: 1.2rem; color: #cbd5e1;">Pending Orders</h2>
        <div id="ordersList"></div>
      </div>

      <script src="/socket.io/socket.io.js"></script>
      <script>
        let authHeader = '';
        const adminSocket = io({ query: { isAdmin: 'true' } });

        adminSocket.on('active_users_update', (data) => {
          const liveElem = document.getElementById('liveCount');
          const visitElem = document.getElementById('visitCount');
          if (liveElem) liveElem.textContent = data.active;
          if (visitElem) visitElem.textContent = data.totalVisits;
        });

        async function loadOrders() {
          const user = document.getElementById('userInput').value;
          const pass = document.getElementById('passInput').value;
          authHeader = 'Basic ' + btoa(user + ':' + pass);

          const res = await fetch('/api/admin/orders', {
            headers: { 'Authorization': authHeader }
          });

          if (res.status === 401) return alert('Invalid Username or Password!');

          const data = await res.json();
          document.getElementById('login').style.display = 'none';
          document.getElementById('dashboard').style.display = 'block';

          const pendingOrders = data.orders.filter(o => o.status === 'Pending Verification');
          const container = document.getElementById('ordersList');

          if (pendingOrders.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#94a3b8; margin-top:30px;">No pending orders.</p>';
            return;
          }

          container.innerHTML = pendingOrders.map(o => \`
            <div class="order-card">
              <p><strong>Order ID:</strong> \${o.orderId}</p>
              <p><strong>Customer:</strong> \${o.customerName} (\${o.customerEmail})</p>
              <p><strong>Time Placed:</strong> 🕒 \${o.createdAt}</p>
              <p><strong>Verification Method:</strong> \${o.verificationType}</p>
              <p><strong>Service:</strong> \${o.serviceName} (ID: \${o.serviceId})</p>
              <p><strong>Link:</strong> <a href="\${o.targetLink}" target="_blank">\${o.targetLink}</a></p>
              <p><strong>Quantity:</strong> \${o.quantity}</p>
              <p><strong>Amount Paid:</strong> ₦\${o.totalCostNGN}</p>
              <p><strong>Receipt:</strong> \${o.receiptUrl ? \`<a href="\${o.receiptUrl}" target="_blank">View Receipt Photo</a>\` : 'Sent via WhatsApp'}</p>
              <div class="btn-group">
                <button class="btn-approve" onclick="approveOrder('\${o.orderId}')">Approve & Send to Provider</button>
                <button class="btn-decline" onclick="declineOrder('\${o.orderId}')">Decline Order</button>
              </div>
            </div>
          \`).join('');
        }

        async function approveOrder(orderId) {
          if (!confirm('Approve order ' + orderId + '?')) return;
          const res = await fetch('/api/admin/approve-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
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

        async function declineOrder(orderId) {
          if (!confirm('Decline order ' + orderId + '?')) return;
          const res = await fetch('/api/admin/decline-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
            body: JSON.stringify({ orderId })
          });
          const data = await res.json();
          if (data.success) {
            alert('Order declined.');
            loadOrders();
          } else {
            alert('Error: ' + (data.error || 'Failed to decline'));
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Protected Admin Middleware & API Endpoints
app.use('/api/admin', (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) return res.status(401).json({ error: 'Unauthorized' });

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii').split(':');
  if (credentials[0] !== ADMIN_USERNAME || credentials[1] !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.get('/api/admin/orders', (req, res) => {
  res.json({ visits: siteVisits, orders: orders });
});

app.post('/api/admin/approve-order', async (req, res) => {
  const { orderId } = req.body;
  const order = orders.find(o => o.orderId === orderId);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'Pending Verification') return res.status(400).json({ error: 'Order already processed' });

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
      saveData();
      res.json({ success: true, message: 'Order approved!', providerOrderId: response.data.order });
    } else {
      order.status = 'API Error';
      res.status(400).json({ error: response.data.error || 'Provider returned an error.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to communicate with provider.' });
  }
});

app.post('/api/admin/decline-order', (req, res) => {
  const { orderId } = req.body;
  const order = orders.find(o => o.orderId === orderId);

  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.status = 'Declined';
  saveData();
  res.json({ success: true, message: 'Order declined.' });
});

// Use server.listen instead of app.listen
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    
