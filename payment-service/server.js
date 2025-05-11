import grpc from "@grpc/grpc-js"
import protoLoader from "@grpc/proto-loader"
import express from "express"
import http from "http"
import path from "path"
import { fileURLToPath } from "url"
import { Kafka } from "kafkajs"

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

// Start HTTP server first
const HTTP_PORT = parseInt(process.env.PORT) || 3007
const HOST = '0.0.0.0' // Listen on all network interfaces

// Kafka configuration
const kafka = new Kafka({
  clientId: 'payment-service',
  brokers: [process.env.KAFKA_BROKER || 'kafka:29092']
})

let producer

async function initializeKafka() {
  try {
    producer = kafka.producer()
    await producer.connect()
    console.log('Kafka producer connected')
  } catch (error) {
    console.error('Error initializing Kafka:', error)
    process.exit(1)
  }
}

server.listen(HTTP_PORT, HOST, async () => {
  console.log(`REST server running on http://${HOST}:${HTTP_PORT}`)
  
  try {
    // Initialize Kafka
    await initializeKafka()
    
    // Then start gRPC server
    const PROTO_PATH = path.resolve('/app/protos/payment.proto')
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    })

    const paymentProto = grpc.loadPackageDefinition(packageDefinition).payment
    
    // gRPC methods implementation
    const grpcServer = new grpc.Server()
    
    grpcServer.addService(paymentProto.PaymentService.service, {
      processPayment: async (call, callback) => {
        const { userId, amount, orderId, cardNumber, cardExpiry, cvv } = call.request
        console.log(`Processing payment of $${amount} for order ${orderId} from user ${userId}`)
        
        try {
          // Validation basique de la carte (simulation)
          if (!cardNumber || !cardExpiry || !cvv) {
            return callback({
              code: grpc.status.INVALID_ARGUMENT,
              message: 'Les informations de paiement sont incomplètes'
            })
          }
          
          // Simulation de traitement de paiement (90% de succès)
          const success = Math.random() > 0.1
          const transactionId = `txn_${Math.random().toString(36).substr(2, 9)}`
          
          if (success) {
            // Publier l'événement de paiement réussi
            await producer.send({
              topic: 'payment.processed',
              messages: [{
                value: JSON.stringify({
                  orderId,
                  userId,
                  amount,
                  transactionId,
                  status: 'success',
                  timestamp: new Date().toISOString()
                })
              }]
            })
            
            callback(null, {
              success: true,
              transactionId,
              message: 'Paiement traité avec succès',
              timestamp: new Date().toISOString()
            })
          } else {
            // Publier l'événement d'échec de paiement
            await producer.send({
              topic: 'payment.failed',
              messages: [{
                value: JSON.stringify({
                  orderId,
                  userId,
                  amount,
                  status: 'failed',
                  reason: 'Échec du traitement du paiement',
                  timestamp: new Date().toISOString()
                })
              }]
            })
            
            callback({
              code: grpc.status.INTERNAL,
              message: 'Le paiement a échoué'
            })
          }
        } catch (error) {
          console.error('Erreur lors du traitement du paiement:', error)
          callback({
            code: grpc.status.INTERNAL,
            message: 'Erreur interne du serveur'
          })
        }
      },

      refundPayment: async (call, callback) => {
        const { transactionId, amount, reason } = call.request
        console.log(`Processing refund for transaction ${transactionId}`)
        
        try {
          if (!transactionId || !amount) {
            return callback({
              code: grpc.status.INVALID_ARGUMENT,
              message: 'Transaction ID et montant sont requis'
            })
          }
          
          // Simulation de remboursement
          const success = Math.random() > 0.1
          const refundId = `ref_${Math.random().toString(36).substr(2, 9)}`
          
          if (success) {
            // Publier l'événement de remboursement
            await producer.send({
              topic: 'payment.refunded',
              messages: [{
                value: JSON.stringify({
                  transactionId,
                  refundId,
                  amount,
                  reason,
                  status: 'refunded',
                  timestamp: new Date().toISOString()
                })
              }]
            })
            
            callback(null, {
              success: true,
              refundId,
              message: 'Remboursement effectué avec succès',
              timestamp: new Date().toISOString()
            })
          } else {
            callback({
              code: grpc.status.INTERNAL,
              message: 'Le remboursement a échoué'
            })
          }
        } catch (error) {
          console.error('Erreur lors du remboursement:', error)
          callback({
            code: grpc.status.INTERNAL,
            message: 'Erreur interne du serveur'
          })
        }
      }
    })

    // Start gRPC server
    grpcServer.bindAsync(
      "0.0.0.0:50052",
      grpc.ServerCredentials.createInsecure(),
      (error, port) => {
        if (error) {
          console.error('Error starting gRPC server:', error)
          process.exit(1)
        }
        console.log(`gRPC server running on port ${port}`)
        grpcServer.start()
      }
    )
  } catch (error) {
    console.error('Error starting services:', error)
    process.exit(1)
  }
})
