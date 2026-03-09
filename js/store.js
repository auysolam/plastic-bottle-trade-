/**
 * Firebase Realtime Sync Store
 */

const firebaseConfig = {
  apiKey: "AIzaSyCg9st5AQQQi81qHLhPswRf62H4VKLQZao",
  authDomain: "recyclehub-21cac.firebaseapp.com",
  projectId: "recyclehub-21cac",
  storageBucket: "recyclehub-21cac.firebasestorage.app",
  messagingSenderId: "399507336057",
  appId: "1:399507336057:web:4d8f295d1eae1cdcc9dda8",
  measurementId: "G-2FS27V1XF7"
};

// Initialize Firebase immediately
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
let db_fs; // Will be initialized in Store constructor or immediately if ready
try {
    db_fs = firebase.firestore();
} catch (e) {
    console.error("Firebase init failed early:", e);
}

const INITIAL_STATE = {
    theme: 'default',
    prices: {
        clear: 15.00,
        color: 8.50,
        mixed: 5.00
    },
    rewards: [
        { id: 1, name: 'กระเป๋าพับได้ Eco', cost: 100, icon: '👜', type: 'icon' },
        { id: 2, name: 'เสื้อยืดลดโลกร้อน', cost: 300, icon: '👕', type: 'icon' },
        { id: 3, name: 'กระติกน้ำเก็บอุณหภูมิ', cost: 500, icon: '🥤', type: 'icon' }
    ],
    redemptions: [],
    currentUserPoints: 500,
    userProfiles: {}, 
    requests: [],
    inventory: {
        clear: { stock: 0, cost: 0, sold: 0, revenue: 0, bought: 0 },
        color: { stock: 0, cost: 0, sold: 0, revenue: 0, bought: 0 },
        mixed: { stock: 0, cost: 0, sold: 0, revenue: 0, bought: 0 }
    },
    inventory_log: [] 
};

class Store {
    constructor() {
        this.data = { ...INITIAL_STATE };
        if (!db_fs) {
            try { db_fs = firebase.firestore(); } 
            catch(e) { console.error("Could not init firestore in constructor", e); }
        }
        
        if (db_fs) {
            this.docRef = db_fs.collection('appData').doc('mainStore');
            this.init();
        } else {
            alert("ระบบฐานข้อมูลไม่พร้อมทำงาน กรุณารีเฟรชหน้าเว็บ");
        }
        
        this.isLoaded = false;
        this.listeners = [];
    }

    init() {
        if (!this.docRef) return;
        
        let initialLoadTimeout = setTimeout(() => {
            if (!this.isLoaded) {
                console.warn("Firebase took too long to load.");
                alert("การเชื่อมต่อฐานข้อมูลล่าช้าผิดปกติ โปรดตรวจสอบอินเทอร์เน็ต หรือลองรีเฟรชหน้าเว็บอีกครั้งครับ");
            }
        }, 5000);

        // Setup Realtime Listener - catches permission errors!
        this.docRef.onSnapshot(
            (doc) => {
                clearTimeout(initialLoadTimeout);
                if (doc.exists) {
                    this.data = doc.data();
                    this.isLoaded = true;
                    this.notifyListeners();
                    
                    if (typeof BroadcastChannel !== 'undefined') {
                        if (!this.bc) this.bc = new BroadcastChannel('recyclehub_sync');
                        this.bc.postMessage({ type: 'DATA_UPDATED' });
                    }
                } else {
                    // Document doesn't exist yet, create it
                    this.isLoaded = true;
                    this.notifyListeners();
                    this.docRef.set(INITIAL_STATE).catch(err => {
                        console.error(err);
                        alert("สร้างฐานข้อมูลไม่ได้ (ตั้งค่า Rules ของ Firebase ผิดหรือเปล่า?): " + err.message);
                    });
                }
            },
            (error) => {
                clearTimeout(initialLoadTimeout);
                console.error("Firebase Listener Error:", error);
                alert("เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล! (กรุณาไปตั้งค่า Rules ใน Firebase -> allow read, write: if true;)\n\n" + error.message);
            }
        );
    }

    subscribe(callback) {
        this.listeners.push(callback);
    }

    notifyListeners() {
        this.listeners.forEach(cb => cb());
    }

    saveData() {
        // Prevent saving if not fully loaded yet
        if (!this.isLoaded) {
            console.warn("Attempted to save data before store was loaded.");
            alert("ฐานข้อมูลยังเชื่อมต่อไม่สำเร็จ หรือถูกบล็อกสิทธิ์การเข้าถึง โปรดรีเฟรชหน้าเว็บแล้วลองใหม่ครับ");
            return false;
        }
        this.docRef.set(this.data, { merge: true }).catch(err => {
            console.error("Error saving data to Firebase:", err);
            alert("บันทึกข้อมูลไม่สำเร็จ (สิทธิ์ไม่พียงพอ หรือ มีรูปภาพขนาดใหญ่เกิน 1MB): " + err.message);
        });
        return true;
    }

    getPrices() { 
        const p = this.data.prices || {};
        return {
            clear: parseFloat(p.clear) || 15.00,
            color: parseFloat(p.color) || 8.50,
            mixed: parseFloat(p.mixed) || 5.00
        }; 
    }
    
    setPrices(clear, color, mixed) {
        this.data.prices.clear = parseFloat(clear);
        this.data.prices.color = parseFloat(color);
        this.data.prices.mixed = parseFloat(mixed);
        this.saveData();
    }

    // Theme Management
    getTheme() {
        return this.data.theme || 'default';
    }

    setTheme(theme) {
        this.data.theme = theme;
        this.saveData();
    }

    // User Profiles
    getUserProfile(userId) {
        if (!this.data.userProfiles) this.data.userProfiles = {};
        return this.data.userProfiles[userId] || null;
    }

    saveUserProfile(userId, profileData) {
        if (!this.data.userProfiles) this.data.userProfiles = {};
        if (!this.data.userProfiles[userId]) {
            this.data.userProfiles[userId] = { points: 0, phone: '' };
        }
        this.data.userProfiles[userId] = { ...this.data.userProfiles[userId], ...profileData };
        this.saveData();
    }

    // Rewards Management
    getRewards() { return this.data.rewards || []; }
    addReward(reward) {
        if (!this.data.rewards) this.data.rewards = [];
        reward.id = Date.now();
        this.data.rewards.push(reward);
        this.saveData();
        return reward;
    }
    updateReward(id, updatedData) {
        if (!this.data.rewards) this.data.rewards = [];
        const index = this.data.rewards.findIndex(r => r.id == id);
        if (index !== -1) {
            this.data.rewards[index] = { ...this.data.rewards[index], ...updatedData };
            this.saveData();
        }
    }
    deleteReward(id) {
        if (!this.data.rewards) this.data.rewards = [];
        this.data.rewards = this.data.rewards.filter(r => r.id != id);
        this.saveData();
    }
    
    // User Points
    getPoints(userId = null) { 
        if(userId) {
            const profile = this.getUserProfile(userId);
            return profile ? profile.points || 0 : 0;
        }
        return this.data.currentUserPoints; 
    }

    addPoints(amount) {
        this.data.currentUserPoints += parseInt(amount);
        this.saveData();
    }

    addPointsByPhone(phone, amount) {
        if (!this.data.userProfiles) this.data.userProfiles = {};
        let found = false;
        for (const [uid, profile] of Object.entries(this.data.userProfiles)) {
            if (profile.phone && profile.phone.replace(/\D/g,'') === phone.replace(/\D/g,'')) {
                profile.points = (profile.points || 0) + parseInt(amount);
                found = true;
                break;
            }
        }
        if (!found) {
            this.data.currentUserPoints += parseInt(amount); // fallback
        }
        this.saveData();
        return found;
    }

    deductPoints(amount, userId = null) {
        if(userId) {
            const profile = this.getUserProfile(userId);
            if(profile && profile.points >= amount) {
                profile.points -= parseInt(amount);
                this.saveData();
                return true;
            }
            return false;
        }

        if(this.data.currentUserPoints >= amount) {
            this.data.currentUserPoints -= parseInt(amount);
            this.saveData();
            return true;
        }
        return false;
    }

    // Redemptions
    getRedemptions() { return this.data.redemptions || []; }
    addRedemption(rewardId, name, phone, userId = null) {
        if (!this.data.redemptions) this.data.redemptions = [];
        const reward = this.data.rewards.find(r => r.id == rewardId);
        if(!reward) return false;

        const redemption = {
            id: Date.now().toString(),
            userId: userId,
            rewardName: reward.name,
            cost: reward.cost,
            userName: name,
            userPhone: phone,
            date: new Date().toISOString(),
            status: 'pending'
        };
        this.data.redemptions.push(redemption);
        this.saveData();
        return true;
    }
    updateRedemptionStatus(id, status) {
        if (!this.data.redemptions) return;
        const req = this.data.redemptions.find(r => r.id === id);
        if (req) {
            req.status = status;
            this.saveData();
        }
    }

    // Requests
    getRequests() { return this.data.requests || []; }
    addRequest(request) {
        if (!this.data.requests) this.data.requests = [];
        request.id = Date.now().toString();
        request.status = 'pending';
        this.data.requests.push(request);
        const success = this.saveData();
        return success ? request : null;
    }
    updateRequestStatus(id, status) {
        if (!this.data.requests) this.data.requests = [];
        const req = this.data.requests.find(r => r.id === id);
        if (req) {
            req.status = status;
            this.saveData();
        }
    }

    // Inventory
    getInventory() {
        if (!this.data.inventory) {
            this.data.inventory = {
                clear: { stock: 0, cost: 0, sold: 0, revenue: 0, bought: 0 },
                color: { stock: 0, cost: 0, sold: 0, revenue: 0, bought: 0 },
                mixed: { stock: 0, cost: 0, sold: 0, revenue: 0, bought: 0 }
            };
        }
        return this.data.inventory;
    }

    addStock(type, kg, cost, date = null) {
        const inv = this.getInventory();
        if (inv[type]) {
            inv[type].stock += parseFloat(kg);
            inv[type].bought = (inv[type].bought || 0) + parseFloat(kg);
            inv[type].cost += parseFloat(cost);
            this.addInventoryLog('buy', type, kg, cost, date);
            this.saveData();
        }
    }

    sellStock(type, kg, revenue, date = null, deductStock = true) {
        const inv = this.getInventory();
        if (inv[type]) {
            if (deductStock) {
                inv[type].stock = Math.max(0, inv[type].stock - parseFloat(kg));
            }
            inv[type].sold += parseFloat(kg);
            inv[type].revenue += parseFloat(revenue);
            this.addInventoryLog('sell', type, kg, revenue, date, deductStock);
            this.saveData();
        }
    }

    // History Log
    getInventoryLogs() {
        return this.data.inventory_log || [];
    }

    addInventoryLog(action, type, kg, amount, date = null, deductStock = true) {
        if (!this.data.inventory_log) this.data.inventory_log = [];
        this.data.inventory_log.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            action,
            type,
            kg: parseFloat(kg),
            amount: parseFloat(amount),
            date: date ? new Date(date).toISOString() : new Date().toISOString(),
            deductStock: action === 'sell' ? deductStock : true
        });
    }
}

// Global instance
const db = new Store();

// Apply theme globally
document.body.setAttribute('data-theme', db.getTheme());
