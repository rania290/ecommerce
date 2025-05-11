import express from 'express';
import { Kafka } from 'kafkajs';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`Orders service running on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Load proto files
const ORDER_PROTO_PATH = path.resolve(__dirname, 'protos/orders.proto');
const PAYMENT_PROTO_PATH = path.resolve(__dirname, 'protos/payment.proto');

const orderPackageDefinition = protoLoader.loadSync(ORDER_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const paymentPackageDefinition = protoLoader.loadSync(PAYMENT_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const orderProto = grpc.loadPackageDefinition(orderPackageDefinition).orders;
const paymentProto = grpc.loadPackageDefinition(paymentPackageDefinition).payment;

// Connect to Kafka
const connectKafka = async () => {
  try {
    const kafka = new Kafka({
      clientId: 'orders-service',
      brokers: [process.env.KAFKA_BROKER]
    });

    const producer = kafka.producer();
    await producer.connect();
    console.log('Connected to Kafka');

    return producer;
  } catch (error) {
    console.error('Failed to connect to Kafka:', error);
    throw error;
  }
};

let kafkaProducer;
connectKafka().then(producer => {
  kafkaProducer = producer;
}).catch(error => {
  console.error('Failed to initialize Kafka:', error);
});

// gRPC server
const server = new grpc.Server();

// gRPC methods
async function createOrder(call, callback) {
  try {
    const { userId, productId, quantity } = call.request;
    
    // Publish order created event
    await kafkaProducer.send({
      topic: 'order-created',
      messages: [
        { value: JSON.stringify({ userId, productId, quantity }) }
      ]
    });
    
    // Process payment
    const paymentClient = new paymentProto.PaymentService('payment-service:50052', grpc.credentials.createInsecure());
    
    paymentClient.processPayment({
      orderId: '123', // This should be generated
      userId,
      amount: 100, // This should be calculated based on the product price
      currency: 'USD'
    }, async (err, response) => {
      if (err) {
        console.error('Error processing payment:', err);
        return callback(err);
      }
      
      // Update inventory
      const inventoryClient = new orderProto.InventoryService('inventory-service:50053', grpc.credentials.createInsecure());
      
      inventoryClient.updateInventory({
        productId,
        quantity: -quantity
      }, async (err, response) => {
        if (err) {
          console.error('Error updating inventory:', err);
          return callback(err);
        }
        
        // Publish order completed event
        await kafkaProducer.send({
          topic: 'order-completed',
          messages: [
            { value: JSON.stringify({ userId, productId, quantity }) }
          ]
        });
        
        callback(null, { id: '123', status: 'COMPLETED' });
      });
    });
  } catch (err) {
    console.error('Error creating order:', err);
    callback({
      code: grpc.status.INTERNAL,
      message: 'Error creating order'
    });
  }
}

// Add service to gRPC server
server.addService(orderProto.OrderService.service, {
  createOrder
});

// Start gRPC server
server.bindAsync(
  '0.0.0.0:50051',
  grpc.ServerCredentials.createInsecure(),
  (err, port) => {
    if (err) {
      console.error('Failed to bind gRPC server:', err);
      process.exit(1);
    }
    server.start();
    console.log(`gRPC server running on port ${port}`);
  }
);
