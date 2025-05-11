import grpc from "@grpc/grpc-js"
import protoLoader from "@grpc/proto-loader"
import express from "express"
import http from "http"
import path from "path"
import { fileURLToPath } from "url"
import { Kafka, Partitioners, logLevel } from "kafkajs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const server = http.createServer(app)

app.use(express.json())

// Health check endpoint
app.get("/health", (req, res) => {
  console.log("Health check called")
  res.status(200).json({ status: "OK" })
})

// Sample inventory data
const inventory = {
  1: 50, // Product ID 1 has 50 items in stock
  2: 100, // Product ID 2 has 100 items in stock
  3: 200, // Product ID 3 has 200 items in stock
}

// Kafka setup
let kafka
let producer

async function initializeKafka() {
  try {
    console.log('Initializing Kafka...')
    kafka = new Kafka({
      clientId: 'inventory-service',
      brokers: [process.env.KAFKA_BROKER || 'kafka:9092'],
      retry: {
        initialRetryTime: 300,
        retries: 10
      }
    })

    producer = kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner
    })

    console.log('Kafka initialized successfully')
    return true
  } catch (error) {
    console.error('Failed to initialize Kafka:', error)
    return false
  }
}

async function connectToKafka() {
  try {
    if (!producer) {
      console.error('Producer not initialized')
      return false
    }

    console.log('Connecting to Kafka...')
    await producer.connect()
    console.log('Connected to Kafka')
    return true
  } catch (error) {
    console.error('Failed to connect to Kafka:', error)
    return false
  }
}

async function publishInventoryUpdate(productId, newStock) {
  try {
    if (!producer) {
      throw new Error('Producer not initialized')
    }

    await producer.send({
      topic: 'inventory-updates',
      messages: [
        {
          value: JSON.stringify({
            productId,
            newStock,
            timestamp: new Date().toISOString()
          })
        }
      ]
    })
    console.log(`Published inventory update for product ${productId}: ${newStock}`)
  } catch (error) {
    console.error('Error publishing inventory update:', error)
    // Don't throw the error, just log it and continue
  }
}

// Start HTTP server first
const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 3005
const HOST = '0.0.0.0' // Écoute sur toutes les interfaces réseau

async function startServer() {
  try {
    // Start HTTP server
    server.listen(HTTP_PORT, HOST, () => {
      console.log(`REST server running on http://${HOST}:${HTTP_PORT}`)
    })

    // Initialize Kafka
    const kafkaInitialized = await initializeKafka()
    if (!kafkaInitialized) {
      console.error('Failed to initialize Kafka, exiting...')
      process.exit(1)
    }

    // Connect to Kafka
    const kafkaConnected = await connectToKafka()
    if (!kafkaConnected) {
      console.error('Failed to connect to Kafka, exiting...')
      process.exit(1)
    }

    // Start gRPC server
    try {
      const PROTO_PATH = path.resolve(__dirname, "../protos/inventory.proto")
      const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      })

      const inventoryProto = grpc.loadPackageDefinition(packageDefinition).inventory
      
      // gRPC methods implementation
      const grpcServer = new grpc.Server()
      
      grpcServer.addService(inventoryProto.InventoryService.service, {
        checkStock: (call, callback) => {
          const { productId } = call.request

          if (inventory[productId] === undefined) {
            return callback({
              code: grpc.status.NOT_FOUND,
              message: "Product not found in inventory",
            })
          }

          callback(null, { quantity: inventory[productId] })
        },

        updateStock: async (call, callback) => {
          const { productId, quantity } = call.request

          if (inventory[productId] === undefined) {
            return callback({
              code: grpc.status.NOT_FOUND,
              message: "Product not found in inventory",
            })
          }

          inventory[productId] = quantity
          
          try {
            await publishInventoryUpdate(productId, quantity)
            callback(null, { success: true, quantity })
          } catch (error) {
            console.error('Error in updateStock:', error)
            callback({
              code: grpc.status.INTERNAL,
              message: "Failed to publish inventory update",
            })
          }
        },

        reserveStock: async (call, callback) => {
          const { productId, quantity } = call.request

          if (inventory[productId] === undefined) {
            return callback({
              code: grpc.status.NOT_FOUND,
              message: "Product not found in inventory",
            })
          }

          if (inventory[productId] < quantity) {
            return callback({
              code: grpc.status.FAILED_PRECONDITION,
              message: "Insufficient stock",
            })
          }

          inventory[productId] -= quantity
          
          try {
            await publishInventoryUpdate(productId, inventory[productId])
            callback(null, { success: true, remainingQuantity: inventory[productId] })
          } catch (error) {
            console.error('Error in reserveStock:', error)
            callback({
              code: grpc.status.INTERNAL,
              message: "Failed to publish inventory update",
            })
          }
        },
      })

      // Start gRPC server
      grpcServer.bindAsync(
        "0.0.0.0:50052",
        grpc.ServerCredentials.createInsecure(),
        (err, port) => {
          if (err) {
            console.error('Failed to bind gRPC server:', err)
            process.exit(1)
          }
          grpcServer.start()
          console.log(`gRPC server running on port ${port}`)
        }
      )
    } catch (error) {
      console.error('Failed to start gRPC server:', error)
      process.exit(1)
    }
  } catch (error) {
    console.error('Failed to start inventory service:', error)
    process.exit(1)
  }
}

// Start the server
startServer()

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...')
  try {
    if (producer && producer.isConnected()) {
      await producer.disconnect()
    }
    process.exit(0)
  } catch (error) {
    console.error('Error during shutdown:', error)
    process.exit(1)
  }
})
