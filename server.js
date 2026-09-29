const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const PROVIDER_API_URL = 'https://mysocialsboost.com/api/v2';
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || '15c176d4487684b0e64e588704e88d93';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads folder exists
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Multer storage configuration for payment receipt uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// In-memory Database (Replace with MongoDB/SQLite for permanent storage in production)
let orders = [];

// Base Wholesale NGN Services (Update provider_service_id values to match your MySocialsBoost service IDs)
const services = [
  { id: 1, platform: 'facebook', name: 'Facebook Page Likes / Followers', rate_per_1000: 1200, category: 'Facebook Followers', provider_service_id: '101' },
  { id: 2, platform: 'facebook', name: 'Facebook Post Likes / Reactions', rate_per_1000: 600, category: 'Facebook Engagement', provider_service_id: '102' },
  { id: 3, platform: 'tiktok', name: 'TikTok High Quality Followers', rate_per_1000: 1800, category: 'TikTok Followers', provider_service_id: '201' },
  { id: 4, platform: 'tiktok', name: 'TikTok Video Views [Instant]', rate_per_1000: 200, category: 'TikTok Views', provider_service_id: '202' },
  { id: 5, platform: 'instagram', name: 'Instagram Real Followers', rate_per_1000: 1500, category: 'Instagram Followers', provider_service_id: '301' },
  { id: 6, platform: 'youtube', name: 'YouTube Video Views', rate_per_1000: 2500, category: 'YouTube Views', provider_service_id: '401' }
];

// Fetch Services with +50% Markup applied
app.get('/api/services', (req, res) => {
  const markedUpServices = services.map(s => ({
    ...s,
    retail_rate_per_1000: Math.round(s.rate_per_1000 * 1.5) // +50% markup
  }));
  res.json(markedUpServices);
});

// Customer Route: Submit Order & Payment Receipt
app.post('/api/orders/create', upload.single('receipt'), (req, res) => {
  try {
    const { serviceId, targetLink, quantity } = req.body;
    const service = services.find(s => s.id === parseInt(serviceId));

    if (!service) return res.status(400).json({ error: 'Invalid service selected' });
    if (!req.file) return res.status(400).json({ error: 'Payment receipt photo is required' });

    const totalCost = Math.round((service.rate_per_1000 * 1.5) * (parseInt(quantity) / 1000));

    const newOrder = {
      orderId: 'ORD-' + Math.floor(100000 + Math.random() * 900000),
      serviceId: service.id,
      serviceName: service.name,
      providerServiceId: service.provider_service_id,
      targetLink,
      quantity: parseInt(quantity),
      totalCostNGN: totalCost,
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

// Admin Route: Get all submitted orders
app.get('/api/admin/orders', (req, res) => {
  res.json(orders);
});

// Admin Route: Approve payment & forward order to MySocialsBoost API
app.post('/api/admin/approve-order', async (req, res) => {
  const { orderId } = req.body;
  const order = orders.find(o => o.orderId === orderId);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'Pending Verification') {
    return res.status(400).json({ error: 'Order is already processed' });
  }

  try {
    // Forward Order to MySocialsBoost API v2
    const params = new URLSearchParams({
      key: PROVIDER_API_KEY,
      action: 'add',
      service: order.providerServiceId,
      link: order.targetLink,
      quantity: order.quantity
    });

    const response = await axios.post(PROVIDER_API_URL, params);

    if (response.data && response.data.order) {
      order.status = 'Approved & Sent to Provider';
      order.providerOrderId = response.data.order;
      res.json({ success: true, message: 'Order approved and forwarded successfully!', providerOrderId: response.data.order });
    } else {
      order.status = 'API Error';
      res.status(400).json({ error: response.data.error || 'Provider API returned an error.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to communicate with MySocialsBoost API.' });
  }
});

app.listen(PORT, () => console.log(`Social Boost server running on port ${PORT}`));
