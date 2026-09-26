const { Engine, Render, Runner, Bodies, Composite, Constraint, Events, Body } = Matter;

const width = 600;
const height = 600;

let engine = null;
let world = null;
let render = null;
let runner = null;

// ==========================================
// ⚙️ パラメータ設定
// ==========================================
const segments = 5;
const totalWidth = 380;
const segWidth = totalWidth / segments;
const segHeight = 24;
const startX = (width - totalWidth) / 2;
const startY = 460;

const wireLength = 1;
const wireAngle = 45;
const dropSpawnY = 50; 
const TURN_TIME_LIMIT = 15;

// ==========================================
// ゲーム状態管理
// ==========================================
let gameMode = 'solo';
let isHost = true;
let currentTurn = 'host';
let isGameOver = false;
let canDrop = true;
let currentActiveBody = null;

let mouseX = width / 2;
let currentAngle = 0;
let isMouseInCanvas = false;
let currentScore = 0;

let landedBlocks = [];
let bridgeBodies = [];
let bridgeConstraints = [];

let remoteMouseX = width / 2;
let remoteAngle = 0;
let isRemoteInCanvas = false;

let turnTimer = null;
let remainingSec = TURN_TIME_LIMIT;

let peer = null;
let p2pConn = null;
let currentRoomNumber = '';

// ==========================================
// 資材定義
// ==========================================
const shapeDefs = {
    box: {
        weightVal: 10,
        density: 0.0005, friction: 1.0, frictionStatic: 5.0, frictionAir: 0.03, restitution: 0.0,
        label: 'block', color: '#c49a6c',
        draw: (ctx) => ctx.fillRect(-20, -20, 40, 40),
        create: (x, y) => Bodies.rectangle(x, y, 40, 40, {
            ...shapeDefs.box,
            collisionFilter: { category: 0x0001, mask: 0xFFFF }
        })
    },
    heavy: {
        weightVal: 35,
        density: 0.001, friction: 1.0, frictionStatic: 5.0, frictionAir: 0.01, restitution: 0.0,
        label: 'block', color: '#f1c40f',
        draw: (ctx) => ctx.fillRect(-15, -25, 30, 50),
        create: (x, y) => Bodies.rectangle(x, y, 30, 50, {
            ...shapeDefs.heavy,
            collisionFilter: { category: 0x0001, mask: 0xFFFF }
        })
    },
    wide: {
        weightVal: 15,
        density: 0.0005, friction: 1.0, frictionStatic: 5.0, frictionAir: 0.06, restitution: 0.0,
        label: 'block', color: '#8b5a2b',
        draw: (ctx) => ctx.fillRect(-35, -12, 70, 24),
        create: (x, y) => Bodies.rectangle(x, y, 70, 24, {
            ...shapeDefs.wide,
            collisionFilter: { category: 0x0001, mask: 0xFFFF }
        })
    },
    tetra: {
        weightVal: 20,
        density: 0.0005, friction: 1.0, frictionStatic: 5.0, frictionAir: 0.02, restitution: 0.0,
        label: 'block', color: '#95a5a6',
        draw: (ctx) => {
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
                const px = 24 * Math.cos(a);
                const py = 24 * Math.sin(a);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
        },
        create: (x, y) => Bodies.polygon(x, y, 5, 24, {
            ...shapeDefs.tetra,
            collisionFilter: { category: 0x0001, mask: 0xFFFF }
        })
    }
};
const shapeKeys = ['box', 'heavy', 'tetra', 'wide'];
function getRandomType() {
    return shapeKeys[Math.floor(Math.random() * shapeKeys.length)];
}
let nextType = getRandomType();

// ==========================================
// 画面切り替え制御
// ==========================================
const titleScreen = document.getElementById('title-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const howModal = document.getElementById('how-modal');
const gameView = document.getElementById('game-view');
const turnBanner = document.getElementById('turn-banner');
const turnTimerDisplay = document.getElementById('turn-timer-display');

document.getElementById('btn-solo').addEventListener('click', () => {
    gameMode = 'solo';
    isHost = true;
    showGameView();
    initPhysics();
});

document.getElementById('btn-multi').addEventListener('click', () => {
    titleScreen.style.display = 'none';
    lobbyScreen.style.display = 'block';
});

document.getElementById('btn-how').addEventListener('click', () => {
    howModal.style.display = 'flex';
});
document.getElementById('btn-close-how').addEventListener('click', () => {
    howModal.style.display = 'none';
});

document.getElementById('btn-lobby-back').addEventListener('click', () => {
    cleanupP2P();
    lobbyScreen.style.display = 'none';
    titleScreen.style.display = 'block';
});

document.getElementById('btn-back-to-title').addEventListener('click', () => {
    cleanupP2P();
    cleanupPhysics();
    gameView.style.display = 'none';
    titleScreen.style.display = 'block';
});
document.getElementById('game-over-title-btn').addEventListener('click', () => {
    cleanupP2P();
    cleanupPhysics();
    gameView.style.display = 'none';
    titleScreen.style.display = 'block';
});

function showGameView() {
    titleScreen.style.display = 'none';
    lobbyScreen.style.display = 'none';
    gameView.style.display = 'block';
    document.getElementById('game-over-screen').style.display = 'none';

    if (gameMode === 'multi') {
        turnBanner.style.display = 'inline-block';
        turnTimerDisplay.style.display = 'block';
        updateTurnUI();
    } else {
        turnBanner.style.display = 'none';
        turnTimerDisplay.style.display = 'none';
    }
}

// ==========================================
// PeerJS P2P 通信処理
// ==========================================
const lobbyStatus = document.getElementById('lobby-status');

document.getElementById('btn-create-room').addEventListener('click', () => {
    isHost = true;
    lobbyStatus.textContent = '4桁の部屋IDを発行中...';
    cleanupP2P();

    currentRoomNumber = Math.floor(1000 + Math.random() * 9000).toString();
    const fullPeerId = 'ktb-' + currentRoomNumber;

    peer = new Peer(fullPeerId);

    peer.on('open', () => {
        document.getElementById('host-id-display').style.display = 'block';
        document.getElementById('my-peer-id').textContent = currentRoomNumber;
        lobbyStatus.textContent = '部屋を作成しました。相手の接続を待機しています...';
    });

    peer.on('connection', (conn) => {
        p2pConn = conn;
        setupP2PConnection();
        lobbyStatus.textContent = 'ゲストが接続しました！対戦を開始します...';
        setTimeout(() => {
            gameMode = 'multi';
            currentTurn = 'host';
            canDrop = true;
            nextType = getRandomType();
            showGameView();
            initPhysics();
            startTurnTimer();
            p2pConn.send({ type: 'init', nextType: nextType, turn: currentTurn });
        }, 1000);
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            lobbyStatus.textContent = 'IDが重複しました。もう一度作成を押してください。';
        } else {
            lobbyStatus.textContent = 'エラー: ' + err.type;
        }
    });
});

document.getElementById('btn-copy-id').addEventListener('click', () => {
    if (!currentRoomNumber) return;
    navigator.clipboard.writeText(currentRoomNumber).then(() => {
        const copyBtn = document.getElementById('btn-copy-id');
        copyBtn.textContent = '完了!';
        setTimeout(() => { copyBtn.textContent = 'コピー'; }, 1500);
    }).catch(() => {
        alert('コピーに失敗しました: ' + currentRoomNumber);
    });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
    const inputVal = document.getElementById('input-room-id').value.trim();
    if (!inputVal) {
        alert('4桁の部屋IDを入力してください');
        return;
    }

    const targetId = inputVal.startsWith('ktb-') ? inputVal : 'ktb-' + inputVal;

    isHost = false;
    lobbyStatus.textContent = '部屋 ' + inputVal + ' に接続要求中...';

    cleanupP2P();
    peer = new Peer();

    peer.on('open', () => {
        p2pConn = peer.connect(targetId);
        setupP2PConnection();
    });

    peer.on('error', (err) => {
        lobbyStatus.textContent = '接続失敗: ' + err.type;
    });
});

function setupP2PConnection() {
    p2pConn.on('open', () => {
        if (!isHost) {
            lobbyStatus.textContent = '接続成功！ゲーム開始を待機中...';
        }
    });

    p2pConn.on('data', (data) => {
        handleP2PMessage(data);
    });

    p2pConn.on('close', () => {
        alert('対戦相手の接続が切断されました。');
        cleanupP2P();
        cleanupPhysics();
        gameView.style.display = 'none';
        titleScreen.style.display = 'block';
    });
}

function handleP2PMessage(data) {
    if (data.type === 'init') {
        gameMode = 'multi';
        nextType = data.nextType;
        currentTurn = data.turn;
        canDrop = isMyTurn();
        drawNextPreview();
        showGameView();
        initPhysics();
        updateTurnUI();
    } else if (data.type === 'sync_state') {
        if (!isHost) applyRemoteState(data);
    } else if (data.type === 'cursor') {
        remoteMouseX = data.x;
        remoteAngle = data.angle;
        isRemoteInCanvas = data.inCanvas;
    } else if (data.type === 'request_drop') {
        // ホスト側：ゲストからの投下を実行
        if (isHost && currentTurn === 'guest' && canDrop && !isGameOver) {
            executeDrop(data.x, data.angle);
        }
    } else if (data.type === 'turn_change') {
        currentTurn = data.turn;
        nextType = data.nextType;
        canDrop = isMyTurn(); // ターン交代でドロップ許可を確実に更新
        drawNextPreview();
        updateTurnUI();
        startTurnTimer();
    } else if (data.type === 'timer_sync') {
        document.getElementById('turn-timer-sec').textContent = data.sec;
    } else if (data.type === 'game_over') {
        handleRemoteGameOver(data);
    } else if (data.type === 'restart_game') {
        restartMatch(false);
    }
}

function cleanupP2P() {
    if (p2pConn) { p2pConn.close(); p2pConn = null; }
    if (peer) { peer.destroy(); peer = null; }
    clearInterval(turnTimer);
}

// ==========================================
// ターン制御 ＆ タイマー
// ==========================================
function isMyTurn() {
    if (gameMode === 'solo') return true;
    return (isHost && currentTurn === 'host') || (!isHost && currentTurn === 'guest');
}

function updateTurnUI() {
    if (gameMode !== 'multi') return;
    if (isMyTurn()) {
        turnBanner.className = 'turn-banner my-turn';
        turnBanner.textContent = 'あなたのターン！';
    } else {
        turnBanner.className = 'turn-banner op-turn';
        turnBanner.textContent = 'あいてのターン中...';
    }
}

function startTurnTimer() {
    clearInterval(turnTimer);
    remainingSec = TURN_TIME_LIMIT;
    document.getElementById('turn-timer-sec').textContent = remainingSec;

    if (!isHost) return;

    turnTimer = setInterval(() => {
        if (isGameOver) { clearInterval(turnTimer); return; }
        remainingSec--;
        document.getElementById('turn-timer-sec').textContent = remainingSec;

        if (p2pConn && p2pConn.open) {
            p2pConn.send({ type: 'timer_sync', sec: remainingSec });
        }

        // タイムアップ時の強制投下
        if (remainingSec <= 0) {
            clearInterval(turnTimer);
            if (canDrop && !isGameOver) {
                const targetX = (currentTurn === 'host') ? mouseX : remoteMouseX;
                const targetAngle = (currentTurn === 'host') ? currentAngle : remoteAngle;
                executeDrop(targetX, targetAngle);
            }
        }
    }, 1000);
}

function switchTurn() {
    currentTurn = (currentTurn === 'host') ? 'guest' : 'host';
    nextType = getRandomType();
    canDrop = isMyTurn();
    drawNextPreview();
    updateTurnUI();
    startTurnTimer();

    if (p2pConn && p2pConn.open) {
        p2pConn.send({
            type: 'turn_change',
            turn: currentTurn,
            nextType: nextType
        });
    }
}

// ==========================================
// 物理シミュレーション (Matter.js)
// ==========================================
let guestCanvas = null;
let guestCtx = null;

function initPhysics() {
    cleanupPhysics();

    const mainContainer = document.getElementById('main-canvas-container');

    if (isHost) {
        engine = Engine.create({
            enableSleeping: false,
            constraintIterations: 4 // 拘束条件の解法反復数を上げてバネのちぎれを防止
        });
        world = engine.world;
        engine.positionIterations = 20;
        engine.velocityIterations = 20;

        render = Render.create({
            element: mainContainer,
            engine: engine,
            options: {
                width: width,
                height: height,
                wireframes: false,
                background: '#87CEEB'
            }
        });
        render.canvas.classList.add('main-cv');
        Render.run(render);

        runner = Runner.create({
            isFixed: true, // 固定デルタタイムにして画面遷移時のワープを防止
            delta: 1000 / 60
        });
        Runner.run(runner, engine);

        createBridge();
        setupPhysicsEvents();
    } else {
        guestCanvas = document.createElement('canvas');
        guestCanvas.width = width;
        guestCanvas.height = height;
        guestCanvas.classList.add('main-cv');
        guestCtx = guestCanvas.getContext('2d');
        mainContainer.appendChild(guestCanvas);
    }

    isGameOver = false;
    canDrop = isMyTurn();
    currentActiveBody = null;
    currentScore = 0;
    landedBlocks = [];

    document.getElementById('score').textContent = '0';
    document.getElementById('stat-height').textContent = '0';
    document.getElementById('stat-weight').textContent = '0';

    drawNextPreview();
    setupCanvasInput();
}

function createBridge() {
    bridgeBodies = [];
    bridgeConstraints = [];

    // 衝突グループを負の共通値にして剛体同士の反発を無効化
    const bridgeGroup = Body.nextGroup ? Body.nextGroup(true) : -1;

    for (let i = 0; i < segments; i++) {
        const x = startX + (i * segWidth) + (segWidth / 2);
        const segment = Bodies.rectangle(x, startY, segWidth, segHeight, {
            friction: 1.0,
            frictionStatic: 5.0,
            frictionAir: 0.1,
            restitution: 0.0,
            density: 0.001,
            label: 'bridge',
            collisionFilter: {
                group: bridgeGroup,
                category: 0x0002,
                mask: 0x0001
            },
            render: { fillStyle: '#2980b9' }
        });
        bridgeBodies.push(segment);
    }

    // 接続点のオフセットを微小に内側へ寄せ、モーメント暴走を防ぐ
    const attachX = (segWidth / 2) - 1;
    const attachY = segHeight / 4;

    for (let i = 0; i < segments - 1; i++) {
        const cTop = Constraint.create({
            bodyA: bridgeBodies[i],
            bodyB: bridgeBodies[i + 1],
            pointA: { x: attachX, y: -attachY },
            pointB: { x: -attachX, y: -attachY },
            stiffness: 0.95,
            damping: 0.7,
            length: 2,
            render: { visible: false }
        });
        const cBottom = Constraint.create({
            bodyA: bridgeBodies[i],
            bodyB: bridgeBodies[i + 1],
            pointA: { x: attachX, y: attachY },
            pointB: { x: -attachX, y: attachY },
            stiffness: 0.95,
            damping: 0.7,
            length: 2,
            render: { visible: false }
        });
        bridgeConstraints.push(cTop, cBottom);
    }

    const rad = wireAngle * (Math.PI / 180);
    const offsetX = Math.cos(rad) * wireLength;
    const offsetY = Math.sin(rad) * wireLength;

    const leftAnchor = Constraint.create({
        pointA: { x: startX - offsetX, y: startY - offsetY },
        bodyB: bridgeBodies[0],
        pointB: { x: -segWidth / 2, y: 0 },
        length: wireLength,
        stiffness: 0.95,
        damping: 0.5,
        render: { strokeStyle: '#ffffff', lineWidth: 4 }
    });

    const rightAnchor = Constraint.create({
        pointA: { x: startX + totalWidth + offsetX, y: startY - offsetY },
        bodyB: bridgeBodies[segments - 1],
        pointB: { x: segWidth / 2, y: 0 },
        length: wireLength,
        stiffness: 0.95,
        damping: 0.5,
        render: { strokeStyle: '#ffffff', lineWidth: 4 }
    });

    const ground = Bodies.rectangle(width / 2, 590, width, 20, { 
        isStatic: true,
        label: 'ground',
        collisionFilter: { category: 0x0004, mask: 0xFFFF },
        render: { fillStyle: '#333' } 
    });

    Composite.add(world, [...bridgeBodies, ...bridgeConstraints, leftAnchor, rightAnchor, ground]);
}

function cleanupPhysics() {
    if (runner) { Runner.stop(runner); runner = null; }
    if (render) {
        Render.stop(render);
        if (render.canvas) render.canvas.remove();
        render = null;
    }
    if (engine) {
        Composite.clear(engine.world);
        Engine.clear(engine);
        engine = null;
    }
    if (guestCanvas) {
        guestCanvas.remove();
        guestCanvas = null;
        guestCtx = null;
    }
}

// ==========================================
// 入力 & 描画イベント
// ==========================================
function setupCanvasInput() {
    const targetCanvas = isHost ? render.canvas : guestCanvas;

    targetCanvas.addEventListener('mousemove', (e) => {
        const rect = targetCanvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        isMouseInCanvas = true;

        // 手番の有無に関わらず、マウス座標は常時相手に送信してカーソルを可視化
        if (gameMode === 'multi' && p2pConn && p2pConn.open) {
            p2pConn.send({ type: 'cursor', x: mouseX, angle: currentAngle, inCanvas: true });
        }
    });

    targetCanvas.addEventListener('mouseleave', () => {
        isMouseInCanvas = false;
        if (gameMode === 'multi' && p2pConn && p2pConn.open) {
            p2pConn.send({ type: 'cursor', x: mouseX, angle: currentAngle, inCanvas: false });
        }
    });

    targetCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (!isMyTurn() || !canDrop || isGameOver) return;

        const rotateStep = Math.PI / 6;
        currentAngle += (e.deltaY > 0) ? rotateStep : -rotateStep;

        if (gameMode === 'multi' && p2pConn && p2pConn.open) {
            p2pConn.send({ type: 'cursor', x: mouseX, angle: currentAngle, inCanvas: true });
        }
    }, { passive: false });

    targetCanvas.addEventListener('click', (e) => {
        if (isGameOver || !canDrop || !isMyTurn()) return;

        const rect = targetCanvas.getBoundingClientRect();
        const dropX = e.clientX - rect.left;

        if (gameMode === 'solo' || isHost) {
            executeDrop(dropX, currentAngle);
        } else {
            canDrop = false; // ゲスト自身は着地待ちに入る
            p2pConn.send({ type: 'request_drop', x: dropX, angle: currentAngle });
        }
    });
}

function executeDrop(x, angle) {
    canDrop = false;
    const def = shapeDefs[nextType];
    const newBody = def.create(x, dropSpawnY);

    Body.setAngle(newBody, angle);
    newBody.render.fillStyle = def.color;
    newBody.weightVal = def.weightVal;
    newBody.isLanded = false;
    newBody.hasTouched = false;

    currentActiveBody = newBody;
    Composite.add(world, newBody);

    currentAngle = 0;
}

function getStressColor(stressRatio) {
    const ratio = Math.min(1.0, Math.max(0.0, stressRatio));
    const hue = (1.0 - ratio) * 220; 
    return `hsl(${hue}, 85%, 45%)`;
}

function renderGuides(mainCtx) {
    const def = shapeDefs[nextType];

    // 自分のプレビュー（自分の手番の時）
    if (canDrop && !isGameOver && isMouseInCanvas && isMyTurn()) {
        mainCtx.save();
        mainCtx.beginPath();
        mainCtx.setLineDash([6, 6]);
        mainCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        mainCtx.lineWidth = 2;
        mainCtx.moveTo(mouseX, dropSpawnY);
        mainCtx.lineTo(mouseX, height - 20);
        mainCtx.stroke();

        mainCtx.translate(mouseX, dropSpawnY);
        mainCtx.rotate(currentAngle);
        mainCtx.globalAlpha = 0.55;
        mainCtx.fillStyle = def.color;
        def.draw(mainCtx);
        mainCtx.restore();
    }

    // 相手のプレビュー（相手の手番中、常に表示）
    if (gameMode === 'multi' && !isGameOver && !isMyTurn() && isRemoteInCanvas) {
        mainCtx.save();
        mainCtx.beginPath();
        mainCtx.setLineDash([4, 4]);
        mainCtx.strokeStyle = 'rgba(231, 76, 60, 0.7)';
        mainCtx.lineWidth = 2;
        mainCtx.moveTo(remoteMouseX, dropSpawnY);
        mainCtx.lineTo(remoteMouseX, height - 20);
        mainCtx.stroke();

        mainCtx.translate(remoteMouseX, dropSpawnY);
        mainCtx.rotate(remoteAngle);
        mainCtx.globalAlpha = 0.5;
        mainCtx.fillStyle = def.color;
        def.draw(mainCtx);
        mainCtx.restore();
    }
}

// ==========================================
// 物理更新 ＆ 同期送信
// ==========================================
function setupPhysicsEvents() {
    Events.on(render, 'afterRender', () => {
        renderGuides(render.context);
    });

    Events.on(engine, 'afterUpdate', () => {
        if (isGameOver) return;

        const activeLandedBlocks = landedBlocks.filter(body => {
            return body.position.y < 570 && body.position.x > 0 && body.position.x < width;
        });

        bridgeBodies.forEach((segment) => {
            const displacement = Math.max(0, segment.position.y - startY);
            let segmentWeight = 0;
            activeLandedBlocks.forEach(block => {
                const dist = Math.abs(block.position.x - segment.position.x);
                if (dist < segWidth * 0.8) {
                    segmentWeight += (block.weightVal || 10);
                }
            });

            const weightFactor = segmentWeight * (5 / segments);
            const stressRatio = Math.min(1.0, (displacement / 40) + (weightFactor / 100));
            segment.render.fillStyle = getStressColor(stressRatio);
        });

        if (activeLandedBlocks.length > 0) {
            let highestY = startY;
            activeLandedBlocks.forEach(body => {
                if (body.bounds.min.y < highestY) highestY = body.bounds.min.y;
            });

            const towerHeight = Math.max(0, Math.floor(startY - highestY));
            const totalWeight = activeLandedBlocks.reduce((sum, body) => sum + (body.weightVal || 10), 0);
            currentScore = Math.floor(towerHeight * (totalWeight / 10) * 0.2);

            document.getElementById('stat-height').textContent = towerHeight;
            document.getElementById('stat-weight').textContent = totalWeight;
            document.getElementById('score').textContent = currentScore;
        } else {
            document.getElementById('stat-height').textContent = '0';
            document.getElementById('stat-weight').textContent = '0';
            document.getElementById('score').textContent = '0';
            currentScore = 0;
        }

        if (gameMode === 'multi' && p2pConn && p2pConn.open) {
            const bodiesData = Composite.allBodies(world).map(b => ({
                label: b.label,
                color: b.render.fillStyle,
                vertices: b.vertices.map(v => ({ x: v.x, y: v.y }))
            }));

            p2pConn.send({
                type: 'sync_state',
                bodies: bodiesData,
                score: currentScore,
                height: document.getElementById('stat-height').textContent,
                weight: document.getElementById('stat-weight').textContent
            });
        }
    });

    Events.on(engine, 'collisionStart', (event) => {
        if (isGameOver) return;

        event.pairs.forEach((pair) => {
            const { bodyA, bodyB } = pair;
            const isBlockA = bodyA.label === 'block';
            const isBlockB = bodyB.label === 'block';
            const isBridgeA = bodyA.label === 'bridge';
            const isBridgeB = bodyB.label === 'bridge';

            if ((isBlockA && (isBridgeB || isBlockB)) || (isBlockB && (isBridgeA || isBlockA))) {
                const blockObj = isBlockA ? bodyA : bodyB;
                blockObj.hasTouched = true;
            }

            // 投下したブロックが接地した際の判定
            if (currentActiveBody) {
                const isCurrentA = (bodyA === currentActiveBody);
                const isCurrentB = (bodyB === currentActiveBody);

                if (isCurrentA || isCurrentB) {
                    const otherBody = isCurrentA ? bodyB : bodyA;
                    if (otherBody.label === 'bridge' || otherBody.label === 'block') {
                        currentActiveBody.hasTouched = true;
                        if (!currentActiveBody.isLanded) {
                            currentActiveBody.isLanded = true;
                            landedBlocks.push(currentActiveBody);
                        }

                        currentActiveBody = null;

                        // ★着地成功で即座にターンを交代し、両者の操作を解放
                        if (gameMode === 'multi') {
                            switchTurn();
                        } else {
                            canDrop = true;
                        }
                    }
                }
            }

            // 地面への接触によるゲームオーバー判定
            if ((bodyA.label === 'ground' && isBlockB) || (bodyB.label === 'ground' && isBlockA)) {
                const droppedBlock = isBlockA ? bodyA : bodyB;
                if (!droppedBlock.hasTouched) {
                    triggerSelfDestructGameOver();
                } else {
                    triggerGameOver();
                }
            }
        });
    });
}

function applyRemoteState(data) {
    if (!guestCtx || !data || !data.bodies) return;

    document.getElementById('score').textContent = data.score || 0;
    document.getElementById('stat-height').textContent = data.height || 0;
    document.getElementById('stat-weight').textContent = data.weight || 0;

    guestCtx.fillStyle = '#87CEEB';
    guestCtx.fillRect(0, 0, width, height);

    data.bodies.forEach(b => {
        if (!b.vertices || b.vertices.length === 0) return;
        guestCtx.beginPath();
        guestCtx.moveTo(b.vertices[0].x, b.vertices[0].y);
        for (let j = 1; j < b.vertices.length; j++) {
            guestCtx.lineTo(b.vertices[j].x, b.vertices[j].y);
        }
        guestCtx.closePath();
        guestCtx.fillStyle = b.color || '#2980b9';
        guestCtx.fill();
        guestCtx.strokeStyle = '#333';
        guestCtx.lineWidth = 1;
        guestCtx.stroke();
    });

    renderGuides(guestCtx);
}

// ==========================================
// ゲームオーバー ＆ 再戦処理
// ==========================================
function triggerSelfDestructGameOver() {
    isGameOver = true;
    canDrop = false;
    clearInterval(turnTimer);

    currentScore = 0;
    document.getElementById('score').textContent = '0';
    document.getElementById('final-score').textContent = '0';

    if (gameMode === 'multi') {
        const loser = currentTurn;
        const amILoser = (loser === 'host' && isHost) || (loser === 'guest' && !isHost);
        document.getElementById('game-over-title').textContent = amILoser ? 'LOSE...' : 'WIN!!';
        document.getElementById('game-over-msg').textContent = amILoser ? '自滅は許されません！あなたの負けです。' : '相手が自滅したため、あなたの勝利です！';

        if (p2pConn && p2pConn.open && isHost) {
            p2pConn.send({ type: 'game_over', selfDestruct: true, loser: loser });
        }
    } else {
        document.getElementById('game-over-title').textContent = '自滅は許されません';
        document.getElementById('game-over-msg').textContent = 'スコア確定させる為に自滅する。これ、恥ずかしいですからね';
    }

    document.getElementById('game-over-screen').style.display = 'flex';
}

function triggerGameOver() {
    isGameOver = true;
    canDrop = false;
    clearInterval(turnTimer);

    if (gameMode === 'multi') {
        const loser = currentTurn;
        const amILoser = (loser === 'host' && isHost) || (loser === 'guest' && !isHost);
        document.getElementById('game-over-title').textContent = amILoser ? 'LOSE...' : 'WIN!!';
        document.getElementById('game-over-msg').textContent = amILoser ? 'タワーを崩壊させてしまいました！' : '相手がタワーを崩壊させました！あなたの勝利です！';

        if (p2pConn && p2pConn.open && isHost) {
            p2pConn.send({ type: 'game_over', selfDestruct: false, loser: loser, finalScore: currentScore });
        }
    } else {
        document.getElementById('game-over-title').textContent = 'GAME OVER';
        document.getElementById('game-over-msg').textContent = '崩壊しました';
        addScoreToRanking(currentScore);
    }

    document.getElementById('final-score').textContent = currentScore;
    document.getElementById('game-over-screen').style.display = 'flex';
}

function handleRemoteGameOver(data) {
    isGameOver = true;
    canDrop = false;
    clearInterval(turnTimer);

    const amILoser = (data.loser === 'host' && isHost) || (data.loser === 'guest' && !isHost);
    document.getElementById('game-over-title').textContent = amILoser ? 'LOSE...' : 'WIN!!';
    
    if (data.selfDestruct) {
        document.getElementById('game-over-msg').textContent = amILoser ? '自滅は許されません！あなたの負けです。' : '相手が自滅したため、あなたの勝利です！';
        document.getElementById('final-score').textContent = '0';
    } else {
        document.getElementById('game-over-msg').textContent = amILoser ? 'タワーを崩壊させてしまいました！' : '相手がタワーを崩壊させました！あなたの勝利です！';
        document.getElementById('final-score').textContent = data.finalScore || currentScore;
    }

    document.getElementById('game-over-screen').style.display = 'flex';
}

function restartMatch(sendSignal = true) {
    document.getElementById('game-over-screen').style.display = 'none';

    if (gameMode === 'solo') {
        initPhysics();
    } else {
        if (sendSignal && p2pConn && p2pConn.open) {
            p2pConn.send({ type: 'restart_game' });
        }

        currentTurn = 'host';
        canDrop = isHost;
        nextType = getRandomType();
        drawNextPreview();
        updateTurnUI();
        initPhysics();
        startTurnTimer();

        if (isHost && p2pConn && p2pConn.open) {
            p2pConn.send({ type: 'init', nextType: nextType, turn: currentTurn });
        }
    }
}

document.getElementById('retry-btn').addEventListener('click', () => {
    restartMatch(true);
});

// ==========================================
// NEXT プレビュー ＆ ランキング管理
// ==========================================
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');

function drawNextPreview() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextCtx.save();
    nextCtx.translate(nextCanvas.width / 2, nextCanvas.height / 2);
    nextCtx.fillStyle = shapeDefs[nextType].color;
    shapeDefs[nextType].draw(nextCtx);
    nextCtx.restore();
}

function getRanking() {
    const saved = localStorage.getItem('tower_high_scores');
    if (saved) {
        try { return JSON.parse(saved); } catch(e) { return [0, 0, 0, 0, 0]; }
    }
    return [0, 0, 0, 0, 0];
}

function saveRanking(ranking) {
    localStorage.setItem('tower_high_scores', JSON.stringify(ranking));
}

function updateRankingUI(currentFinalScore = null) {
    const ranking = getRanking();
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '';

    ranking.forEach((sc, idx) => {
        const li = document.createElement('li');
        li.className = `ranking-item rank-${idx + 1}`;
        if (currentFinalScore !== null && sc === currentFinalScore && sc > 0) {
            li.classList.add('current');
        }
        li.innerHTML = `<span>${idx + 1}位</span> <span>${sc}</span>`;
        listEl.appendChild(li);
    });
}

function addScoreToRanking(score) {
    if (score <= 0) return;
    let ranking = getRanking();
    ranking.push(score);
    ranking.sort((a, b) => b - a);
    ranking = ranking.slice(0, 5);
    saveRanking(ranking);
    updateRankingUI(score);
}
updateRankingUI();

// ==========================================
// [A]+[C] 長押しハイスコアリセット
// ==========================================
const activeKeys = {};
let resetTimer = null;
let resetStartTime = 0;
const RESET_HOLD_TIME = 3000;

const progressContainer = document.getElementById('reset-progress-container');
const progressBar = document.getElementById('reset-progress-bar');

function checkResetTrigger() {
    const isAPressed = activeKeys['a'] || activeKeys['A'];
    const isCPressed = activeKeys['c'] || activeKeys['C'];

    if (isAPressed && isCPressed) {
        if (!resetTimer) {
            resetStartTime = Date.now();
            progressContainer.style.display = 'block';

            resetTimer = setInterval(() => {
                const elapsed = Date.now() - resetStartTime;
                const pct = Math.min(100, (elapsed / RESET_HOLD_TIME) * 100);
                progressBar.style.width = `${pct}%`;

                if (elapsed >= RESET_HOLD_TIME) {
                    clearInterval(resetTimer);
                    resetTimer = null;
                    localStorage.removeItem('tower_high_scores');
                    updateRankingUI();
                    alert('ハイスコア&ランキングをリセットしました');
                    cancelResetTrigger();
                }
            }, 50);
        }
    } else {
        cancelResetTrigger();
    }
}

function cancelResetTrigger() {
    if (resetTimer) {
        clearInterval(resetTimer);
        resetTimer = null;
    }
    progressContainer.style.display = 'none';
    progressBar.style.width = '0%';
}

window.addEventListener('keydown', (e) => {
    activeKeys[e.key] = true;
    checkResetTrigger();
    if ((e.key === 'r' || e.key === 'R') && gameView.style.display !== 'none') {
        restartMatch(true);
    }
});

window.addEventListener('keyup', (e) => {
    activeKeys[e.key] = false;
    checkResetTrigger();
});
