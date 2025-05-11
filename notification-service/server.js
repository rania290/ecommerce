import { Kafka } from "kafkajs"
import express from 'express';

// Initialiser Express
const app = express();
app.use(express.json());

// Endpoint de santé
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'notification-service' });
});

// Démarrer le serveur
const PORT = process.env.PORT || 3011;
const server = app.listen(PORT, () => {
  console.log(`Notification service running on port ${PORT}`);
});

// Gestion des erreurs du serveur
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Setup Kafka consumer
const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'notification-service',
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
});

const consumer = kafka.consumer({ 
  groupId: 'notification-group',
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
      topic: 'order-events', 
      fromBeginning: true 
    });
    
    console.log('Starting Kafka consumer for notifications...');
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const event = JSON.parse(message.value.toString());
          console.log(`Received event: ${event.type}`);

          switch (event.type) {
            case "ORDER_CREATED":
              sendOrderConfirmation(event.payload);
              break;
            case "ORDER_SHIPPED":
              sendShippingNotification(event.payload);
              break;
            case "ORDER_DELIVERED":
              sendDeliveryNotification(event.payload);
              break;
            default:
              console.log(`Unknown event type: ${event.type}`);
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      },
    });
    
    isConsumerRunning = true;
    console.log('Notification consumer is running');
  } catch (error) {
    console.error('Failed to start notification consumer:', error);
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
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Redémarrer le consommateur en cas d'erreur non gérée
  isConsumerRunning = false;
  startConsumer().catch(console.error);
});

function sendOrderConfirmation(order) {
  console.log(`Sending order confirmation email for order ${order.id} to user ${order.userId}`);
  // In a real application, you would integrate with an email service
}

function sendShippingNotification(order) {
  console.log(`Sending shipping notification for order ${order.id} to user ${order.userId}`);
  // In a real application, you would integrate with an email/SMS service
}

function sendDeliveryNotification(order) {
  console.log(`Sending delivery notification for order ${order.id} to user ${order.userId}`);
  // In a real application, you would integrate with an email/SMS service
}

// Gestion de l'arrêt propre
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully');
  await consumer.disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
