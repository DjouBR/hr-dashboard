const express = require('express');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = process.env.PORT || 3000;

// Configuração do banco de dados SQLite
const db = new sqlite3.Database('./heartrate.db', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT,
        age INTEGER,
        max_hr INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        student_id TEXT,
        start_time DATETIME,
        end_time DATETIME,
        FOREIGN KEY (student_id) REFERENCES students (id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS heartrate_data (
        data_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        heart_rate INTEGER,
        calories REAL,
        zone INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions (session_id)
    )`);
}

// Servidor HTTP
const server = app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});

// Servidor WebSocket
const wss = new WebSocket.Server({ server });

// Armazena alunos ativos em memória
const activeStudents = new Map();

wss.on('connection', (ws) => {
    console.log('Novo cliente conectado');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'student_data') {
                const studentData = processStudentData(data);
                activeStudents.set(data.studentId, studentData);
                
                // Envia atualização para todos os dashboards
                broadcastToDashboards({
                    type: 'update',
                    data: studentData
                });
                
            } else if (data.type === 'dashboard_connect') {
                // Envia todos os alunos ativos para o novo dashboard
                ws.send(JSON.stringify({
                    type: 'initial_data',
                    data: Array.from(activeStudents.values())
                }));
            }
            
        } catch (err) {
            console.error('Erro ao processar mensagem:', err);
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

function processStudentData(data) {
    // Calcular zona de treino (5 zonas)
    const maxHR = 220 - data.age;
    const percentage = (data.heartRate / maxHR) * 100;
    let zone;
    
    if (percentage < 50) zone = 0;
    else if (percentage < 60) zone = 1;
    else if (percentage < 70) zone = 2;
    else if (percentage < 80) zone = 3;
    else if (percentage < 90) zone = 4;
    else zone = 5;
    
    // Preparar dados para o dashboard
    const studentData = {
        id: data.studentId,
        name: data.name || 'Aluno Desconhecido',
        heartRate: data.heartRate,
        calories: data.calories || 0,
        zone: zone,
        age: data.age || 25,
        maxHR: maxHR,
        lastUpdate: new Date().toISOString()
    };

    // Armazenar no banco de dados
    db.serialize(() => {
        db.get("SELECT id FROM students WHERE id = ?", [data.studentId], (err, row) => {
            if (!row) {
                db.run("INSERT INTO students (id, name, age, max_hr) VALUES (?, ?, ?, ?)", 
                    [data.studentId, studentData.name, studentData.age, maxHR]);
            }
            
            db.get(`SELECT session_id FROM sessions 
                   WHERE student_id = ? AND end_time IS NULL`, 
                   [data.studentId], (err, session) => {
                
                if (!session) {
                    const sessionId = generateSessionId();
                    db.run(`INSERT INTO sessions 
                          (session_id, student_id, start_time) 
                          VALUES (?, ?, datetime('now'))`, 
                          [sessionId, data.studentId]);
                    
                    db.run(`INSERT INTO heartrate_data 
                          (session_id, heart_rate, calories, zone) 
                          VALUES (?, ?, ?, ?)`,
                          [sessionId, data.heartRate, data.calories, zone]);
                } else {
                    db.run(`INSERT INTO heartrate_data 
                          (session_id, heart_rate, calories, zone) 
                          VALUES (?, ?, ?, ?)`,
                          [session.session_id, data.heartRate, data.calories, zone]);
                }
            });
        });
    });

    return studentData;
}

function broadcastToDashboards(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function generateSessionId() {
    return 'sess-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

// Health check para o Render
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'UP',
        activeStudents: activeStudents.size,
        dbConnected: db.open
    });
});
