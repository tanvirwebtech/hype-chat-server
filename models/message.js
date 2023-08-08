const mongoose = require("mongoose");
const MessageSchema = new mongoose.Schema(
    {
        sender: { type: mongoose.Types.ObjectId, ref: "user" },
        recipient: { type: mongoose.Types.ObjectId, ref: "user" },
        text: String,
    },
    { timestamps: true }
);

const messageModel = mongoose.model("Message", MessageSchema);

module.exports = messageModel;
