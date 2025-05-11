import express from 'express';
import mongoose from 'mongoose';
import { Kafka } from 'kafkajs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Product schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  stock: { type: Number, required: true }
});

const Product = mongoose.model('Product', productSchema);

// Kafka setup
const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'products-service',
  brokers: [process.env.KAFKA_BROKER || 'kafka:29092'],
  ssl: false,
  sasl: undefined,  // Désactive explicitement SASL
  connectionTimeout: 10000,
  authenticationTimeout: 10000,
  reauthenticationThreshold: 10000,
  retry: {
    initialRetryTime: 1000,
    retries: 5,
    maxRetryTime: 5000
  }
});

const producer = kafka.producer();

async function connectKafka() {
  try {
    await producer.connect();
    console.log('Connected to Kafka');
  } catch (error) {
    console.error('Kafka connection error:', error);
    setTimeout(connectKafka, 5000);
  }
}

connectKafka();

// Create topics
async function createTopics() {
  try {
    await kafka.admin().createTopics({
      topics: [
        { topic: 'product-events', numPartitions: 1, replicationFactor: 1 },
        { topic: 'inventory-updates', numPartitions: 1, replicationFactor: 1 }
      ],
      waitForLeaders: true
    });
  } catch (err) {
    console.error('Error creating topics:', err);
  }
}

createTopics();

// Consumer setup
const consumer = kafka.consumer({ 
  groupId: 'products-group',
  retry: {
    initialRetryTime: 1000,
    retries: 5
  }
});

let isConsumerRunning = false;

async function startConsumer() {
  if (isConsumerRunning) return;
  
  try {
    await consumer.connect();
    await consumer.subscribe({ 
      topic: 'inventory-updates', 
      fromBeginning: true 
    });
    
    console.log('Starting Kafka consumer...');
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const event = JSON.parse(message.value.toString());
          console.log('Received event:', event);
          
          // Update product stock based on inventory update
          if (topic === 'inventory-updates') {
            const product = await Product.findById(event.productId);
            if (product) {
              product.stock = event.newStock;
              await product.save();
            }
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      },
    });
    
    isConsumerRunning = true;
    console.log('Kafka consumer is running');
  } catch (error) {
    console.error('Failed to start Kafka consumer:', error);
    // Réessayer après un délai en cas d'échec
    setTimeout(startConsumer, 5000);
  }
}

// Démarrer le consommateur après un court délai pour laisser le temps à Kafka de démarrer
setTimeout(() => {
  startConsumer().catch(console.error);
}, 10000);

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);n  // Redémarrer le consommateur en cas d'erreur non gérée
  isConsumerRunning = false;
  startConsumer().catch(console.error);
});

// Routes
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, description, price, stock } = req.body;
    
    // Check if product exists
    const existingProduct = await Product.findOne({ name });
    if (existingProduct) {
      return res.status(400).json({ error: 'Product already exists' });
    }

    // Create new product
    const product = new Product({
      name,
      description,
      price,
      stock
    });

    await product.save();

    // Publish Kafka event
    await producer.send({
      topic: 'product-events',
      messages: [{
        value: JSON.stringify({
          type: 'PRODUCT_CREATED',
          data: product
        })
      }]
    });

    res.status(201).json(product);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const product = await Product.findByIdAndUpdate(id, updates, { new: true });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Publish event to Kafka
    await producer.send({
      topic: 'product-events',
      messages: [
        {
          value: JSON.stringify({
            type: 'PRODUCT_UPDATED',
            data: product
          })
        }
      ]
    });

    res.json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Publish event to Kafka
    await producer.send({
      topic: 'product-events',
      messages: [
        {
          value: JSON.stringify({
            type: 'PRODUCT_DELETED',
            data: { id }
          })
        }
      ]
    });

    res.json({ message: 'Product deleted' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Products service running on port ${PORT}`);
});