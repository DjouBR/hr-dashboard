const express = require('express');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = process.env.PORT || 10000; // Usando a porta do Render

// Adicione estas linhas para permitir CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Banco de dados
const db = new sqlite3.Database(':memory:', (err) => { // Alterado para memória temporária
    if (err) console.error(err);
    else initializeDatabase();
});

// Websocket Server
const wss = new WebSocket.Server({ noServer: true });
const activeStudents = new Map();

// HTTP Server
const server = app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});

// Upgrade HTTP para WebSocket
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// WebSocket Connection
wss.on('connection', (ws) => {
    console.log('Nova conexão estabelecida');
    console.log('Nova conexão - IP:', ws._socket.remoteAddress);
    ws.on('message', (message) => {
        console.log('Mensagem recebida:', message.toString()); // DEBUG
        console.log('Mensagem recebida de', ws._socket.remoteAddress, ':', message.toString());
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'student_data') {
                handleStudentData(ws, data);
            } else if (data.type === 'professor_connect') {
                handleProfessorConnect(ws);
            }
        } catch (err) {
            console.error('Erro ao processar mensagem:', err);
        }
    });

    ws.on('close', () => console.log('Cliente desconectado'));
});

// Funções principais
function handleStudentData(ws, data) {
    const studentData = {
        id: data.studentId,
        name: data.name || 'Aluno',
        heartRate: data.heartRate,
        calories: data.calories || 0,
        age: data.age || 25,
        zone: calculateZone(data.heartRate, data.age),
        lastUpdate: new Date().toISOString()
    };

    activeStudents.set(data.studentId, studentData);
    broadcastUpdate(studentData, ws); // Passe a conexão do aluno como segundo parâmetro
    storeInDatabase(studentData);
}

function handleProfessorConnect(ws) {
    console.log('Dashboard do professor conectado');
    console.log('Dashboard conectado - Total alunos:', activeStudents.size);
    // Garanta que o Map está sincronizado com o banco
    db.all("SELECT DISTINCT student_id FROM heartrate_data WHERE timestamp > datetime('now', '-5 minutes')", 
        (err, rows) => {
            rows.forEach(row => {
                if (!activeStudents.has(row.student_id)) {
                    activeStudents.set(row.student_id, {
                        id: row.student_id,
                        name: 'Aluno Recuperado',
                        heartRate: 0,
                        zone: -1
                    });
                }
            });
            
            ws.send(JSON.stringify({
                type: 'initial_data',
                data: Array.from(activeStudents.values())
            }));
        });
    //ws.send(JSON.stringify({
    //    type: 'initial_data',
    //    data: Array.from(activeStudents.values())
    //}));
}

function broadcastUpdate(data, senderWs) {
    wss.clients.forEach(client => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'student_update',
                data: data
            }));
        }
    });
}

// Funções auxiliares
function calculateZone(heartRate, age) {
    if (!age || !heartRate) return -1;
    const percentage = (heartRate / (220 - age)) * 100;
    
    if (percentage < 50) return 0;
    if (percentage < 60) return 1;
    if (percentage < 70) return 2;
    if (percentage < 80) return 3;
    if (percentage < 90) return 4;
    return 5;
}

function storeInDatabase(data) {
    // Implementação simplificada para testes
    db.run(
        `INSERT INTO heartrate_data(student_id, heart_rate, zone) 
         VALUES(?, ?, ?)`,
        [data.id, data.heartRate, data.zone]
    );
}

function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS heartrate_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT,
            heart_rate INTEGER,
            zone INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    );
}

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'UP',
        activeStudents: activeStudents.size,
        lastUpdate: new Date()
    });
});
