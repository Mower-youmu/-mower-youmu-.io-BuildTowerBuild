const { Engine, Render, Runner, Bodies, Composite, Constraint, Events, Body } = Matter;

const width = 600;
const height = 600;

const engine = Engine.create();
const world = engine.world;

engine.positionIterations = 15;
engine.velocityIterations = 15;

const mainContainer = document.getElementById('main-canvas-container');

const render = Render.create({
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
const runner = Runner.create();
Runner.run(runner, engine);

// ==========================================
// ⚙️ パラメータ調整エリア
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
// ==========================================

let isGameOver = false;
let canDrop = true;
let currentActiveBody = null;

let mouseX = width / 2;
let currentAngle = 0;
let isMouseInCanvas = false;

let currentScore = 0;

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

const landedBlocks = [];

// --- 1. しなる1枚板 ---
const bridgeBodies = [];
const bridgeConstraints = [];

const group = Body.nextGroup ? Body.nextGroup(true) : -1;

for (let i = 0; i < segments; i++) {
    const x = startX + (i * segWidth) + (segWidth / 2);
    const segment = Bodies.rectangle(x, startY, segWidth + 2, segHeight, {
        friction: 1.0,
        frictionStatic: 5.0,
        frictionAir: 0.05,
        restitution: 0.0,
        density: 0.0009,
        label: 'bridge',
        collisionFilter: { group: group },
        render: { fillStyle: '#2980b9' }
    });
    bridgeBodies.push(segment);
}

for (let i = 0; i < segments - 1; i++) {
    const cTop = Constraint.create({
        bodyA: bridgeBodies[i],
        bodyB: bridgeBodies[i + 1],
        pointA: { x: segWidth / 2, y: -segHeight / 3 },
        pointB: { x: -segWidth / 2, y: -segHeight / 3 },
        stiffness: 0.99,
        damping: 0.5,
        length: 0,
        render: { visible: false }
    });
    const cBottom = Constraint.create({
        bodyA: bridgeBodies[i],
        bodyB: bridgeBodies[i + 1],
        pointA: { x: segWidth / 2, y: segHeight / 3 },
        pointB: { x: -segWidth / 2, y: segHeight / 3 },
        stiffness: 0.99,
        damping: 0.5,
        length: 0,
        render: { visible: false }
    });
    bridgeConstraints.push(cTop, cBottom);
}

// --- 2. ワイヤー固定 ---
const rad = wireAngle * (Math.PI / 180);
const offsetX = Math.cos(rad) * wireLength;
const offsetY = Math.sin(rad) * wireLength;

const leftAnchor = Constraint.create({
    pointA: { x: startX - offsetX, y: startY - offsetY },
    bodyB: bridgeBodies[0],
    pointB: { x: -segWidth / 2, y: 0 },
    length: wireLength,
    stiffness: 0.9,
    damping: 0.3,
    render: { strokeStyle: '#ffffff', lineWidth: 4 }
});

const rightAnchor = Constraint.create({
    pointA: { x: startX + totalWidth + offsetX, y: startY - offsetY },
    bodyB: bridgeBodies[segments - 1],
    pointB: { x: segWidth / 2, y: 0 },
    length: wireLength,
    stiffness: 0.9,
    damping: 0.3,
    render: { strokeStyle: '#ffffff', lineWidth: 4 }
});

const ground = Bodies.rectangle(width / 2, 590, width, 20, { 
    isStatic: true, 
    label: 'ground',
    render: { fillStyle: '#333' } 
});

Composite.add(world, [...bridgeBodies, ...bridgeConstraints, leftAnchor, rightAnchor, ground]);

// --- 3. NEXT プレビュー & 落下物 ---
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');

const shapeDefs = {
    box: {
        weightVal: 10,
        density: 0.0005, friction: 1.0, frictionStatic: 5.0, frictionAir: 0.03, restitution: 0.0,
        label: 'block',
        color: '#c49a6c',
        draw: (ctx) => ctx.fillRect(-20, -20, 40, 40),
        create: (x, y) => Bodies.rectangle(x, y, 40, 40, shapeDefs.box)
    },
    heavy: {
        weightVal: 35,
        density: 0.001, friction: 1.0, frictionStatic: 5.0, frictionAir: 0.01, restitution: 0.0,
        label: 'block',
        color: '#f1c40f',
        draw: (ctx) => ctx.fillRect(-15, -25, 30, 50),
        create: (x, y) => Bodies.rectangle(x, y, 30, 50, shapeDefs.heavy)
    },
    wide: {
        weightVal: 15,
        density: 0.0005, friction: 1.0, frictionStatic: 5.0, frictionAir: 0.06, restitution: 0.0,
        label: 'block',
        color: '#8b5a2b',
        draw: (ctx) => ctx.fillRect(-35, -12, 70, 24),
        create: (x, y) => Bodies.rectangle(x, y, 70, 24, shapeDefs.wide)
    },
    tetra: {
        weightVal: 20,
        density: 0.0005, friction: 1.0, frictionStatic: 5.0, frictionAir: 0.02, restitution: 0.0,
        label: 'block',
        color: '#95a5a6',
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
        create: (x, y) => Bodies.polygon(x, y, 5, 24, shapeDefs.tetra)
    }
};

const shapeKeys = ['box', 'heavy', 'tetra', 'wide'];

function getRandomType() {
    return shapeKeys[Math.floor(Math.random() * shapeKeys.length)];
}

let nextType = getRandomType();

function drawNextPreview() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextCtx.save();
    nextCtx.translate(nextCanvas.width / 2, nextCanvas.height / 2);
    nextCtx.fillStyle = shapeDefs[nextType].color;
    shapeDefs[nextType].draw(nextCtx);
    nextCtx.restore();
}

drawNextPreview();

render.canvas.addEventListener('mousemove', (e) => {
    const rect = render.canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    isMouseInCanvas = true;
});

render.canvas.addEventListener('mouseleave', () => {
    isMouseInCanvas = false;
});

render.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    if (!canDrop || isGameOver) return;

    const rotateStep = Math.PI / 6;
    if (e.deltaY > 0) {
        currentAngle += rotateStep;
    } else {
        currentAngle -= rotateStep;
    }
}, { passive: false });

function getStressColor(stressRatio) {
    const ratio = Math.min(1.0, Math.max(0.0, stressRatio));
    const hue = (1.0 - ratio) * 220; 
    return `hsl(${hue}, 85%, 45%)`;
}

Events.on(render, 'afterRender', () => {
    if (!canDrop || isGameOver || !isMouseInCanvas) return;

    const mainCtx = render.context;
    const def = shapeDefs[nextType];

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
            if (body.bounds.min.y < highestY) {
                highestY = body.bounds.min.y;
            }
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

                    canDrop = true;
                    currentActiveBody = null;
                }
            }
        }

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

function triggerSelfDestructGameOver() {
    isGameOver = true;
    canDrop = false;
    
    currentScore = 0;
    document.getElementById('score').textContent = '0';
    document.getElementById('final-score').textContent = '0';

    document.getElementById('game-over-title').textContent = '自滅は許されません';
    document.getElementById('game-over-msg').textContent = 'スコア確定させる為に自滅する。これ、恥ずかしいですからね';
    document.getElementById('game-over-screen').style.display = 'flex';
}

function triggerGameOver() {
    isGameOver = true;
    canDrop = false;
    
    document.getElementById('game-over-title').textContent = 'GAME OVER';
    document.getElementById('game-over-msg').textContent = '崩壊しました';

    addScoreToRanking(currentScore);

    document.getElementById('final-score').textContent = currentScore;
    document.getElementById('game-over-screen').style.display = 'flex';
}

render.canvas.addEventListener('click', (e) => {
    if (isGameOver || !canDrop) return;

    const rect = render.canvas.getBoundingClientRect();
    const dropX = e.clientX - rect.left;

    canDrop = false;

    const def = shapeDefs[nextType];
    const newBody = def.create(dropX, dropSpawnY);
    
    Body.setAngle(newBody, currentAngle);
    newBody.render.fillStyle = def.color;

    newBody.weightVal = def.weightVal;
    newBody.isLanded = false;
    newBody.hasTouched = false;

    currentActiveBody = newBody;

    Composite.add(world, newBody);

    nextType = getRandomType();
    currentAngle = 0;
    drawNextPreview();
});

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

    if (e.key === 'r' || e.key === 'R') {
        location.reload();
    }
});

window.addEventListener('keyup', (e) => {
    activeKeys[e.key] = false;
    checkResetTrigger();
});