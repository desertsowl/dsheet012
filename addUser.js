const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    group: { type: Number, required: true },
    status: { type: Number, required: true },
    email: { type: String, unique: true, required: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    unique: { type: Number, unique: true, required: true }
});

userSchema.pre('save', function (next) {
    this.updated_at = new Date();
    next();
});

const User = mongoose.model('User', userSchema, 'everyone');

async function createUser(username, password, group, status, email, unique) {
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            username,
            password: hashedPassword,
            group,
            status,
            email,
            unique
        });
        await user.save();
        console.log(`User ${username} created successfully.`);
    } catch (err) {
        console.error(`Error creating user ${username}:`, err);
    }
}

async function main() {
    await mongoose.connect('mongodb://localhost/staff', { useNewUrlParser: true, useUnifiedTopology: true });

    await createUser('admin@dsheet', 'admin', 8, 2, 'admin@dsheet.com', 1);
    await createUser('manager@dsheet', 'manager', 4, 2, 'manager@dsheet.com', 2);
    await createUser('worker@dsheet', 'worker', 2, 2, 'worker@dsheet.com', 3);
    await createUser('guest@dsheet', 'guest', 1, 2, 'guest@dsheet.com', 4);

    mongoose.disconnect();
}

main().catch(err => console.error('Error in main:', err));
