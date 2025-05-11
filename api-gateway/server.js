import express from "express"
import { createProxyMiddleware } from "http-proxy-middleware"
import { ApolloServer } from "@apollo/server"
import { expressMiddleware } from "@apollo/server/express4"
import { loadFiles } from "@graphql-tools/load-files"
import { makeExecutableSchema } from "@graphql-tools/schema"
import path from "path"
import { fileURLToPath } from "url"
import grpc from "@grpc/grpc-js"
import protoLoader from "@grpc/proto-loader"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express();
app.use(express.json());
app.use(cors());

// Configure CORS
app.use(cors({
  origin: '*',
  credentials: true
}));

// Add logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// REST API Proxies
// Dans api-gateway/server.js
app.use(
  "/api/products",
  createProxyMiddleware({
    target: "http://products-service:3001",  // Utiliser le nom du service au lieu de localhost
    changeOrigin: true,
    timeout: 60000,  // Augmenter le timeout
    secure: false
  }),
)

app.use(
  "/api/users",
  createProxyMiddleware({
    target: "http://users-service:3002",
    changeOrigin: true,
    secure: false,
    logLevel: 'debug',
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
    }
  }),
);

// gRPC client setup for Orders service
const PROTO_PATH = "/protos/orders.proto"

try {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  const ordersProto = grpc.loadPackageDefinition(packageDefinition).orders
  const ordersClient = new ordersProto.OrderService("orders-service:50051", grpc.credentials.createInsecure())

  // REST API for Orders (which will use gRPC internally)
  app.post("/api/orders", (req, res) => {
    const orderData = req.body
    ordersClient.createOrder(orderData, (error, response) => {
      if (error) {
        console.error('Error creating order:', error);
        return res.status(500).json({ error: 'Failed to create order' });
      }
      res.json(response)
    })
  })

  app.get("/api/orders/:id", (req, res) => {
    const orderId = req.params.id

    ordersClient.getOrder({ id: orderId }, (err, response) => {
      if (err) {
        console.error("Error fetching order:", err)
        return res.status(500).json({ error: "Failed to fetch order" })
      }
      res.json(response)
    })
  })
} catch (error) {
  console.error('Failed to initialize gRPC client:', error.message)
  console.log('Orders service will not be available')
}

// GraphQL setup
async function startApolloServer() {
  const typeDefs = await loadFiles(path.join(__dirname, "schema.graphql"))

  const resolvers = {
    Query: {
      // These resolvers will delegate to the respective microservices
      products: async () => {
        const response = await fetch("http://localhost:3001/api/products")
        return response.json()
      },
      product: async (_, { id }) => {
        const response = await fetch(`http://localhost:3001/api/products/${id}`)
        return response.json()
      },
      users: async () => {
        const response = await fetch("http://localhost:3002/api/users")
        return response.json()
      },
      user: async (_, { id }) => {
        const response = await fetch(`http://localhost:3002/api/users/${id}`)
        return response.json()
      },
    },
    Mutation: {
      createOrder: (_, { input }) => {
        return new Promise((resolve, reject) => {
          ordersClient.createOrder(input, (err, response) => {
            if (err) reject(err)
            else resolve(response)
          })
        })
      },
    },
  }

  const schema = makeExecutableSchema({ typeDefs, resolvers })
  const server = new ApolloServer({ schema })

  await server.start()

  app.use("/graphql", expressMiddleware(server))
}

startApolloServer().then(() => {
  app.get("/health", (req, res) => {
    res.json({ status: "OK", service: "api-gateway" });
  });
  
  app.listen(3000, () => {
    console.log("API Gateway running on http://localhost:3000")
    console.log("GraphQL endpoint: http://localhost:3000/graphql")
  })
})
