# 🔐 Плани реалізації Password Security

## КРИТИЧНО: Як правильно реалізувати безпеку паролей

### Поточна ситуація (УРАЗЛИВО) ❌
```javascript
// app.js lines 234-242
function doLogin() {
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  const user  = getUsers().find(u => u.email === email && u.password === pass);
  // Пароли зберігаються і порівнюються як PLAINTEXT
  if (!user) return authErr('Неверный email или пароль');
  onAuth(user);
  console.warn('⚠️ SECURITY: Using plaintext password comparison. Use bcrypt on production backend!');
}
```

### Правильне рішення

#### OPTION A: Backend BCrypt (✅ РЕКОМЕНДУЄТЬСЯ)

**Крок 1: Backend Implementation (Node.js)**

```javascript
// backend/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const router = express.Router();
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, department } = req.body;
    
    // Validate input
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Check if user exists
    const existingUser = await db.users.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Create user (NEVER store plaintext password)
    const user = await db.users.create({
      id: crypto.randomUUID(),
      email,
      passwordHash,  // Store HASH only
      name,
      department,
      role: 'user',
      createdAt: new Date()
    });
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await db.users.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Compare hashed password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        role: user.role,
        department: user.department 
      } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Middleware для перевірки токену
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

module.exports = { router, authenticateToken };
```

**Крок 2: Frontend Implementation**

```javascript
// app.js - Нова реалізація
async function doLogin() {
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  
  try {
    // Send to backend
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (!response.ok) {
      return authErr('Неверный email или пароль');
    }
    
    const { token, user } = await response.json();
    
    // Store token (NOT password!)
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
    
    onAuth(user);
  } catch (error) {
    console.error('Login error:', error);
    authErr('Ошибка при входе. Попробуйте позже.');
  }
}

async function doRegister() {
  const name  = document.getElementById('r-name').value.trim();
  const email = document.getElementById('r-email').value.trim().toLowerCase();
  const pass  = document.getElementById('r-pass').value;
  const dept  = document.getElementById('r-dept').value.trim();
  
  if (!name || !email || !pass) {
    return authErr('Заполните обязательные поля');
  }
  if (pass.length < 6) {
    return authErr('Пароль минимум 6 символов');
  }
  
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, name, department: dept })
    });
    
    if (!response.ok) {
      const data = await response.json();
      return authErr(data.error || 'Ошибка регистрации');
    }
    
    const { token, user } = await response.json();
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
    onAuth(user);
  } catch (error) {
    console.error('Register error:', error);
    authErr('Ошибка регистрации. Попробуйте позже.');
  }
}

// Middleware для всех API запросів
async function apiCall(endpoint, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return fetch(endpoint, {
    ...options,
    headers
  });
}
```

#### OPTION B: Client-Side Hashing (⚠️ TEMPORARY - НОП ЖШ за bcrypt)

Якщо backend недоступний, як мінімум:

```javascript
// Встановити crypto-js
// <script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.0/crypto-js.min.js"></script>

function doLogin() {
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  
  // Client-side hashing (better than plaintext, but still not ideal)
  const salt = 'some-fixed-salt-from-config';
  const hashedPassword = CryptoJS.SHA256(pass + salt).toString();
  
  const user = getUsers().find(u => 
    u.email === email && 
    u.passwordHash === hashedPassword  // Compare hashes instead
  );
  
  if (!user) return authErr('Неверный email или пароль');
  onAuth(user);
  console.warn('⚠️ Client-side hashing - still not production ready! Use server-side bcrypt!');
}

function doRegister() {
  const name  = document.getElementById('r-name').value.trim();
  const email = document.getElementById('r-email').value.trim().toLowerCase();
  const pass  = document.getElementById('r-pass').value;
  const dept  = document.getElementById('r-dept').value.trim();
  
  if (!name || !email || !pass) return authErr('Заполните обязательные поля');
  if (pass.length < 6) return authErr('Пароль минимум 6 символов');
  
  const users = getUsers();
  if (users.find(u => u.email === email)) return authErr('Email уже зарегистрирован');
  
  // Hash password
  const salt = 'some-fixed-salt-from-config';
  const passwordHash = CryptoJS.SHA256(pass + salt).toString();
  
  const user = {
    id: DB.uid(),
    email,
    passwordHash,  // Store HASH
    name,
    department: dept,
    role: 'user'
  };
  
  users.push(user);
  saveUsers(users);
  
  // Important: Never log the plaintext password
  console.warn('⚠️ Client-side hashing - use bcrypt on backend for production!');
  
  onAuth(user);
}
```

---

## 🔄 Session Token Management

```javascript
// Реализация JWT Token refresh
const TOKEN_EXPIRY_WARNING = 50 * 60 * 1000; // 50 мин из 60мин жизни

let tokenCheckTimer;

function startTokenCheck() {
  tokenCheckTimer = setInterval(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    
    try {
      // Decode token (assuming JWT format)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiresAt = payload.exp * 1000;
      const now = Date.now();
      
      if (expiresAt - now < TOKEN_EXPIRY_WARNING) {
        refreshToken();
      }
    } catch (e) {
      // Invalid token format
      doLogout();
    }
  }, 60000); // Check every minute
}

async function refreshToken() {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      }
    });
    
    if (response.ok) {
      const { token } = await response.json();
      localStorage.setItem('auth_token', token);
    } else {
      doLogout();
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }
}

function startExpiryWatcher() {
  startTokenCheck();
}

function stopExpiryWatcher() {
  if (tokenCheckTimer) clearInterval(tokenCheckTimer);
}
```

---

## 📋 Чек-лист Реализации

### Phase 1: Backend Setup
- [ ] Install bcrypt package: `npm install bcrypt jsonwebtoken`
- [ ] Create `/backend/auth.js` with login/register flows
- [ ] Create middleware для verification токенів
- [ ] Setup `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`
- [ ] Add rate limiting на auth endpoints
- [ ] Setup HTTPS (обов'язково!)
- [ ] Setup environment variable для JWT_SECRET

### Phase 2: Frontend Update
- [ ] Remove plaintext password storage
- [ ] Implement token-based auth
- [ ] Add API call wrapper с auth headers
- [ ] Implement token refresh logic
- [ ] Add session timeout check
- [ ] Remove old DB storage of passwords

### Phase 3: Migration
- [ ] Create migration script для хешування старих паролей
- [ ] Notify users про password reset requirement
- [ ] Force re-login после успішного migration
- [ ] Cleanup старого localStorage

### Phase 4: Security
- [ ] Add password strength validation
- [ ] Implement 2FA (optional but recommended)
- [ ] Add audit logging
- [ ] Add failed login attempts tracking
- [ ] Setup alert на suspicious activity

---

## ⚠️ ЗАБОРОНЯТИ

```javascript
❌ localStorage.setItem('password', plaintext_password);
❌ const hashedPassword = md5(password); // MD5 не безпечна!
❌ const hashedPassword = sha1(password); // SHA1 не безпечна!
❌ api.login({ password: plaintext_password }); // На незахищеному каналі!
❌ db.users.passwordHash = password; // Сберігання plaintext
❌ console.log('password:', password); // Логування паролей!
❌ password in URL: /login?email=user@test.com&password=123 
```

---

## ✅ ДОЗВОЛИТИ

```javascript
✅ const hash = await bcrypt.hash(password, 10);
✅ const valid = await bcrypt.compare(password, hash);
✅ localStorage.setItem('auth_token', jwt_token);
✅ api.login({ email, password }, { https: true });
✅ db.users.passwordHash = bcrypt_hash;
✅ console.log('User logged in:', user.email); // Без пароля!
✅ POST /api/auth/login with body { email, password }
```

---

**Статус**: 🔴 У РОБОТІ  
**Priority**: 🔴 CRÍTICO  
**Target Date**: До наступного deployment'u  
**Owner**: Security Team
