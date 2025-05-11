import { Kafka, Partitioners } from "kafkajs"
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3010;

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Setup Kafka consumer with legacy partitioner
const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'analytics-service',
  brokers: [process.env.KAFKA_BROKER || 'kafka:29092'],
  ssl: false,
  sasl: undefined,
  connectionTimeout: 10000,
  authenticationTimeout: 10000,
  reauthenticationThreshold: 10000,
  retry: {
    initialRetryTime: 1000,
    retries: 5,
    maxRetryTime: 5000
  }
})

const consumer = kafka.consumer({ 
  groupId: "analytics-group",
  createPartitioner: Partitioners.LegacyPartitioner 
})

// Simple in-memory analytics store
const analytics = {
  orderCount: 0,
  totalRevenue: 0,
  productSales: {},
}

async function start() {
  try {
    await consumer.connect()
    console.log("Connected to Kafka")

    await consumer.subscribe({ topic: "order-events", fromBeginning: true })


    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const event = JSON.parse(message.value.toString())
          console.log(`Processing event for analytics: ${event.type}`)

          if (event.type === "ORDER_CREATED") {
            analytics.orderCount++
            analytics.totalRevenue += event.total
            
            event.items.forEach(item => {
              analytics.productSales[item.productId] = (analytics.productSales[item.productId] || 0) + item.quantity
            })
            
            console.log('Updated analytics:', analytics)
          }
        } catch (error) {
          console.error('Error processing message:', error)
        }
      },
    })


    // Start the Express server
    app.listen(PORT, () => {
      console.log(`Analytics service running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });

  } catch (error) {
    console.error('Error in analytics service:', error)
    process.exit(1)
  }
}

start().catch(console.error)
