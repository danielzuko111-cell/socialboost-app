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

// Dynamically fetch live services directly from MySocialsBoost API
// Set your preferred USD to NGN exchange rate here
const USD_TO_NGN = 1650; 

app.get('/api/services', async (req, res) => {
  try {
    const params = new URLSearchParams({
      key: PROVIDER_API_KEY,
      action: 'services'
    });

    const response = await axios.post(PROVIDER_API_URL, params);
    
    if (Array.isArray(response.data)) {
      const markedUpServices = response.data.map(s => {
        const wholesaleRateUSD = parseFloat(s.rate);
        
        // 1. Convert USD rate to NGN
        const wholesaleRateNGN = wholesaleRateUSD * USD_TO_NGN;
        
        // 2. Add 50% Markup (Multiply by 1.5)
        const retailRateNGN = Math.round(wholesaleRateNGN * 1.5);

        return {
          id: s.service,
          name: s.name,
          category: s.category,
          rate_per_1000: wholesaleRateNGN,
          retail_rate_per_1000: retailRateNGN,
          min: s.min,
          max: s.max
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
      createdAt: new Date().toISOString()
    };

    orders.unshift(newOrder);
    res.json({ success: true, message: 'Order submitted! Verification pending.', orderId: newOrder.orderId });
  } catch (error) {
    res.status(500).json({ error: 'Server error creating order.' });
  }
});

// Admin Routes
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
