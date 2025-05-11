import express from "express"
import { ApolloServer } from "@apollo/server"
import { expressMiddleware } from "@apollo/server/express4"

// Sample user data
const users = [
  { id: "1", username: "john_doe", email: "john@example.com", firstName: "John", lastName: "Doe" },
  { id: "2", username: "jane_smith", email: "jane@example.com", firstName: "Jane", lastName: "Smith" },
]

// Initialize Express app
const app = express()
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'users-service' });
});

// REST API
app.get("/api/users", (req, res) => {
  res.json(users)
})

app.get("/api/users/:id", (req, res) => {
  const user = users.find((u) => u.id === req.params.id)
  if (!user) {
    return res.status(404).json({ error: "User not found" })
  }
  res.json(user)
})

app.post("/api/users", (req, res) => {
  const newUser = {
    id: (users.length + 1).toString(),
    ...req.body,
  }
  users.push(newUser)
  res.status(201).json(newUser)
})

// GraphQL setup
const typeDefs = `
  type User {
    id: ID!
    username: String!
    email: String!
    firstName: String
    lastName: String
  }

  type Query {
    users: [User!]!
    user(id: ID!): User
  }

  type Mutation {
    createUser(username: String!, email: String!, firstName: String, lastName: String): User!
  }
`

const resolvers = {
  Query: {
    users: () => users,
    user: (_, { id }) => users.find(user => user.id === id)
  },
  Mutation: {
    createUser: (_, args) => {
      const newUser = {
        id: (users.length + 1).toString(),
        ...args
      }
      users.push(newUser)
      return newUser
    }
  },
}

const server = new ApolloServer({ 
  typeDefs, 
  resolvers,
  // Enable introspection and playground in development
  introspection: true,
})

async function startServer() {
  try {
    await server.start()
    
    // Apply Apollo middleware
    app.use(
      "/graphql",
      expressMiddleware(server, {
        context: async ({ req }) => ({ token: req.headers.token }),
      })
    )

    // Start the server
    const PORT = process.env.PORT || 3003
    app.listen(PORT, () => {
      console.log(`Users service running on http://localhost:${PORT}`)
      console.log(`GraphQL endpoint: http://localhost:${PORT}/graphql`)
      console.log(`Health check: http://localhost:${PORT}/health`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  // You might want to exit the process or handle the error appropriately
})

startServer()
