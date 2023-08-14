const express = require("express");
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const user = require("./models/user");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const ws = require("ws");
const Message = require("./models/message");

// APP
const app = express();
const port = process.env.PORT || 5000;

// MIDDLEWARE
app.use(
    cors({
        origin: `${process.env.CLIENT_URL}`,
        credentials: true, //access-control-allow-credentials:true
        optionSuccessStatus: 200,
    })
);
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vas6gka.mongodb.net/?retryWrites=true&w=majority`;

const chatSalt = bcrypt.genSaltSync(10);

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await mongoose.connect(uri);
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log(
            "Pinged your deployment. You successfully connected to MongoDB!"
        );

        const getUserDataFromReq = async (req) => {
            return new Promise((resolve, reject) => {
                const token = req.cookies?.token;
                if (token) {
                    jwt.verify(
                        token,
                        process.env.JWT_SECRETE,
                        {},
                        (err, data) => {
                            if (err) throw err;
                            resolve(data);
                        }
                    );
                } else {
                    reject("no token");
                }
            });
        };

        app.get("/", (req, res) => {
            res.json("Server is running...");
        });

        app.get("/profile", (req, res) => {
            const token = req.cookies?.token;
            if (token) {
                jwt.verify(token, process.env.JWT_SECRETE, {}, (err, data) => {
                    if (err) throw err;
                    res.json(data);
                });
            } else {
                res.status(404).json("no token");
            }
        });

        app.get("/offlineUsers", async (req, res) => {
            const offlineUsers = await user.find({});
            res.json(offlineUsers);
        });

        app.get("/messages/:userId", async (req, res) => {
            const { userId } = req.params;
            const userData = await getUserDataFromReq(req);
            const ourUserId = userData.userId;
            const messages = await Message.find({
                sender: { $in: [userId, ourUserId] },
                recipient: { $in: [userId, ourUserId] },
            }).sort({ createdAt: 1 });
            res.json(messages);
        });

        app.post("/login", async (req, res) => {
            const { username, password } = req.body;
            const foundUser = await user.findOne({ username });
            if (foundUser) {
                const isPassOk = bcrypt.compareSync(
                    password,
                    foundUser.password
                );
                if (isPassOk) {
                    jwt.sign(
                        { userId: foundUser._id, username },
                        process.env.JWT_SECRETE,
                        {},
                        (err, token) => {
                            if (err) throw err;
                            res.cookie("token", token, {
                                sameSite: "none",
                                secure: true,
                            }).json("ok");
                        }
                    );
                } else {
                    res.status(401).json("invalid password");
                }
            } else {
                res.status(404).json("user not found");
            }
        });
        app.post("/register", async (req, res) => {
            const { username, password } = req.body;

            const hashedPass = bcrypt.hashSync(password, chatSalt);
            try {
                const createdUser = await user.create({
                    username,
                    password: hashedPass,
                });
                jwt.sign(
                    { userId: createdUser._id, username },
                    process.env.JWT_SECRETE,
                    {},
                    (err, token) => {
                        res.cookie("token", token, {
                            sameSite: "none",
                            secure: true,
                        })
                            .status(201)
                            .json("ok");
                    }
                );
            } catch (error) {
                if (error) {
                    res.json(error.message);
                }
            }
        });
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

const server = app.listen(port, () => {
    console.log(`listening on port ${port}`);
});

const wss = new ws.WebSocketServer({ server });

wss.on("connection", (connection, req) => {
    function notifyAboutConnection() {
        [...wss.clients].forEach((c) => {
            c.send(
                JSON.stringify({
                    online: [...wss.clients].map((user) => ({
                        userId: user.userId,
                        username: user.username,
                    })),
                })
            );
        });
    }

    connection.isAlive = true;
    connection.timer = setInterval(() => {
        connection.ping();
        connection.deathTimer = setTimeout(() => {
            connection.isAlive = false;
            clearInterval(connection.timer);
            connection.terminate();
            notifyAboutConnection();
        }, 1000);
    }, 5000);

    connection.on("pong", () => {
        clearTimeout(connection.deathTimer);
    });

    const cookie = req.headers.cookie;

    if (cookie) {
        const cookieStr = cookie
            .split("; ")
            .find((str) => str.startsWith("token="));

        if (cookieStr) {
            const token = cookieStr.split("=")[1];

            jwt.verify(token, process.env.JWT_SECRETE, {}, (err, data) => {
                if (err) throw err;
                const { userId, username } = data;
                connection.userId = userId;
                connection.username = username;
            });
        }
    }

    connection.on("message", async (message) => {
        const messageData = JSON.parse(message.toString());
        const { recipient, text } = messageData;
        if (recipient && text) {
            const messageDoc = await Message.create({
                sender: connection.userId,
                recipient,
                text,
            });

            [...wss.clients]
                .filter((c) => c.userId === recipient)
                .forEach((c) =>
                    c.send(
                        JSON.stringify({
                            text,
                            sender: connection.userId,
                            recipient,
                            id: messageDoc._id,
                        })
                    )
                );
        }
    });

    notifyAboutConnection();
});
