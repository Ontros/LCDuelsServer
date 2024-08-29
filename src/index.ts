// import express from 'express'
import { WebSocketServer, WebSocket } from 'ws';
// const app = express()
// const port = 3000

// var seed = "64";

//REASONS
//1 - won because other player died
//2 - lost because other player survived
//3 - won because more loot
//4 - lost because less loot
//5 - won because leaving faster
//6 - lost because leaving slower
//7 - won because other player chickened out
//8 - lost because you chickened out
//9 - won because surviving longer
//10 - lost because dieing sooner
//11 - won higher quota
//12 - lost lower quota
//13 - won more loot on ship
//14 - lost less loot on ship
//15 - won Bo3
//16 - lost Bo3

// app.get('/', (req, res) => {
//     res.send(seed);
// })

// app.get('/:value', (req, res) => {
//     // Get the value from the URL parameter
//     const newValue = parseInt(req.params.value, 10);

//     // Check if the value is a valid integer
//     if (isNaN(newValue)) {
//         res.status(400).send('Invalid value. Please provide a valid integer.');
//         return;
//     }

//     // Update the internal variable
//     seed = newValue.toString();

//     // Send a response back to the client
//     res.send(`Internal variable set to ${seed}`);
// });

// app.listen(port, () => {
//     console.log(`LCDuels server listening on port ${port}`)
// })

//Credit: ChatGPT xddddddd
interface Player {
    id: string;
    username: string;
    socket: WebSocket;
    opponent?: Player;
    ready: boolean;
    waitingForResult: boolean;
    dead: boolean;
    score: number;
    points: number;
    queueName: string;
    gameMode: 1 | 2 | 3;
}

// Create a new WebSocket server
const wss = new WebSocketServer({ port: 8080 });

const queue: { [key: string]: (Player | undefined) } = {};

wss.on('connection', (ws: WebSocket) => {
    let player: Player;

    ws.on('message', (message: string) => {
        const data = JSON.parse(message);
        if (player) {
            console.log(player.username, data)
        }
        else {
            console.log("New player", data)
        }

        switch (data.type) {
            case 'register':
                var queueName = data.queueName ? data.queueName.toLowerCase().trim() : ""
                if (queueName == "" && data.version != "v62") {
                    ws.send(JSON.stringify({ type: 'error', value: "Please use V62 for public queues" }))
                    break;
                }
                var gameMode = parseInt(data.gameMode)
                console.log(gameMode);
                if (gameMode != 1 && gameMode != 2 && gameMode != 3) {
                    ws.send(JSON.stringify({ type: 'error', value: "Invalid game mode, please update the mod!" }))
                    break;
                }
                if (data.modVersion != "1.2.0.0") {
                    ws.send(JSON.stringify({ type: 'error', value: "Invalid mod version, please update the mod! Use 1.2.0" }))
                    break;
                }
                if (player && player.socket && player.opponent) {
                    console.log("in_game_error detected, players opponent", player.opponent)
                    player.socket.send(JSON.stringify({ type: "in_game_error" }));
                }
                else {
                    player = { id: data.steamId, username: data.steamUsername, socket: ws, ready: false, score: 0, waitingForResult: false, dead: false, queueName, gameMode, points: 0 };
                    matchPlayers(player, queueName)
                }
                break;

            case 'ready':
                if (player && player.opponent && player.socket && player.opponent.socket) {
                    player.ready = true;
                    if (player.opponent.ready) {
                        player.socket.send(JSON.stringify({ type: 'game_start' }));
                        player.opponent.socket.send(JSON.stringify({ type: 'game_start' }));
                    }
                }
                break;

            case 'position':
                if (player && player.opponent && player.socket && player.opponent.socket) {
                    player.opponent.socket.send(JSON.stringify({ type: 'position', value: data.value }));
                }
                break;

            case 'score':
                if (player && player.opponent && player.socket && player.opponent.socket && !player.waitingForResult) {
                    player.score = parseInt(data.value);
                    player.opponent.socket.send(JSON.stringify({ type: 'score', value: data.value }));
                    //End waiting
                    if (player.opponent.waitingForResult && player.opponent.dead && player.score >= player.opponent.score && player.gameMode == 1) {
                        player.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                        player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        gameEnd(player);
                    }
                    else if (player.opponent.waitingForResult && !player.opponent.score && player.score && player.gameMode == 1) {
                        player.socket.send(JSON.stringify({ type: 'won', value: "7" }))
                        player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "8" }))
                        gameEnd(player);
                    }
                }
                break;
            case 'death':
                if (player && player.socket && player.socket && player.opponent?.socket) {
                    player.dead = true;
                    if (player.gameMode == 1) {
                        player.waitingForResult = true;
                    }
                }
                break;

            case 'liftoff':
                if (player && player.opponent && player.socket && player.opponent.socket) {
                    player.waitingForResult = true;
                    evaluateGameResult(player)
                }
                break;
            case 'eject':
                if (player && player.opponent && player.socket && player.opponent.socket) {
                    ws.send(JSON.stringify({ type: 'error', value: "Please dont eject" }))
                    handleLeaving(player)
                }
                break;

            case 'chat':
                if (player && player.opponent && player.socket && player.opponent.socket) {
                    player.opponent.socket.send(JSON.stringify({ type: 'chat', value: data.value }))
                }
                break;

            case 'leave':
                handleLeaving(player);
                break;
        }
    });

    ws.on('close', () => {
        handleLeaving(player);
    });
});

function evaluateGameResult(player: Player) {
    switch (player.gameMode) {
        case 1:
            if (player.opponent?.waitingForResult) {
                if (player.dead) {
                    if (player.opponent.dead) {
                        //Both died
                        //Based on loot
                        if (player.opponent.score > player.score) {
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        }
                        else if (player.score > player.opponent.score) {
                            player.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        }
                        else {
                            //Score tie won the player that survived longest
                            player.socket.send(JSON.stringify({ type: 'won', value: "9" }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "10" }))
                        }
                    }
                    else {
                        if (player.opponent.score == 0 && player.score) {
                            //Opponent chicked out
                            player.socket.send(JSON.stringify({ type: 'won', value: "7" }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "8" }))
                        }
                        else {
                            //Only you died
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "1" }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "2" }))
                        }
                    }
                }
                else {
                    if (player.opponent.dead) {
                        if (player.score == 0 && player.opponent.score) {
                            //You chickened out
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "7" }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "8" }))
                        }
                        else {
                            //Only opponent died
                            player.socket.send(JSON.stringify({ type: 'won', value: "1" }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "2" }))
                        }
                    }
                    else {
                        //Both survived
                        //Based on loot
                        if (player.opponent.score > player.score) {
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        }
                        else if (player.score > player.opponent.score) {
                            player.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        }
                        else {
                            //Score tie won the player that left sooner
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "5" }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "6" }))
                        }
                    }
                }
                gameEnd(player)
            }
            else {
                if (player.opponent) {
                    if (player.dead && player.score < player.opponent.score) {
                        player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3" }));
                        player.socket.send(JSON.stringify({ type: 'lost', value: "4" }));
                        gameEnd(player);
                    }
                    else if (player.dead && player.score == player.opponent.score) {
                        player.opponent.socket.send(JSON.stringify({ type: 'won', value: "9" }));
                        player.socket.send(JSON.stringify({ type: 'lost', value: "10" }));
                        gameEnd(player);
                    }
                }
            }
            break;
        case 2:
        case 3:
            if (player.opponent?.waitingForResult) {
                if (player.dead) {
                    if (player.opponent.dead) {
                        //Both died
                        //Based on loot
                        if (player.opponent.score > player.score) {
                            player.opponent.points++;
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3", yourScore: player.opponent.points, enemyScore: player.points }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "4", yourScore: player.points, enemyScore: player.opponent?.points }))
                        }
                        else if (player.score > player.opponent.score) {
                            player.points++;
                            player.socket.send(JSON.stringify({ type: 'won', value: "3", yourScore: player.points, enemyScore: player.opponent?.points }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "4", yourScore: player.opponent.points, enemyScore: player.points }))
                        }
                        else {
                            //Score tie won the player that survived longest
                            player.points++;
                            player.socket.send(JSON.stringify({ type: 'won', value: "9", yourScore: player.points, enemyScore: player.opponent?.points }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "10", yourScore: player.opponent.points, enemyScore: player.points }))
                        }
                    }
                    else {
                        if (player.opponent.score == 0 && player.score) {
                            //Opponent chicked out
                            player.points++;
                            player.socket.send(JSON.stringify({ type: 'won', value: "7", yourScore: player.points, enemyScore: player.opponent?.points }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "8", yourScore: player.opponent.points, enemyScore: player.points }))
                        }
                        else {
                            //Only you died
                            player.points++;
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "1", yourScore: player.opponent.points, enemyScore: player.points }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "2", yourScore: player.points, enemyScore: player.opponent?.points }))
                        }
                    }
                }
                else {
                    if (player.opponent.dead) {
                        if (player.score == 0 && player.opponent.score) {
                            //You chickened out
                            player.opponent.points++;
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "7", yourScore: player.opponent.points, enemyScore: player.points }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "8", yourScore: player.points, enemyScore: player.opponent?.points }))
                        }
                        else {
                            //Only opponent died
                            player.points++;
                            player.socket.send(JSON.stringify({ type: 'won', value: "1", yourScore: player.points, enemyScore: player.opponent?.points }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "2", yourScore: player.opponent.points, enemyScore: player.points }))
                        }
                    }
                    else {
                        //Both survived
                        //Based on loot
                        if (player.opponent.score > player.score) {
                            player.opponent.points++;
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3", yourScore: player.opponent.points, enemyScore: player.points }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "4", yourScore: player.points, enemyScore: player.opponent?.points }))
                        }
                        else if (player.score > player.opponent.score) {
                            player.points++;
                            player.socket.send(JSON.stringify({ type: 'won', value: "3", yourScore: player.points, enemyScore: player.opponent?.points }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "4", yourScore: player.opponent.points, enemyScore: player.points }))
                        }
                        else {
                            //Score tie won the player that left sooner
                            player.opponent.points++;
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "5", yourScore: player.opponent.points, enemyScore: player.points }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "6", yourScore: player.points, enemyScore: player.opponent?.points }))
                        }
                    }
                }
            }
            player.waitingForResult = true;
            if (player.points == 2 && player.gameMode == 2) {
                player.socket.send(JSON.stringify({ type: 'won', value: "15", yourScore: player.points, enemyScore: player.opponent?.points }))
                player.opponent?.socket.send(JSON.stringify({ type: 'lost', value: "16", yourScore: player.opponent.points, enemyScore: player.points }))
            }
            else if (player.opponent?.points == 2 && player.gameMode == 2) {
                player.opponent.socket.send(JSON.stringify({ type: 'won', value: "15", yourScore: player.opponent.points, enemyScore: player.points }))
                player.socket.send(JSON.stringify({ type: 'lost', value: "16", yourScore: player.points, enemyScore: player.opponent.points }))
            }
            else if (player.opponent?.waitingForResult) {
                setTimeout(() => {
                    const seed = Math.floor(Math.random() * 100000000) + 1;

                    if (player.opponent) {
                        player.ready = false;
                        player.opponent.ready = false;
                        player.socket.send(JSON.stringify({ type: 'match_found', opponentId: player.opponent.id, opponentUsername: player.opponent.username, seed, gameMode: player.gameMode }));
                        player.opponent.socket.send(JSON.stringify({ type: 'match_found', opponentId: player.id, opponentUsername: player.username, seed, gameMode: player.gameMode }));
                        player.waitingForResult = false;
                        player.opponent.waitingForResult = false;
                    }
                    else {
                        console.log("opponent left furing the 1s cooldown")
                    }
                }, 1000)
            }
            break;
    }
}

function gameEnd(player: Player) {
    if (player && player.opponent) {
        console.log("ending game");
        player.opponent.opponent = undefined
        player.opponent = undefined
    }
}

function matchPlayers(pl: Player, queueName: string) {
    console.log("queue start", queue)
    const player2 = queue[queueName];
    if (player2) {
        const player1 = pl;

        player1.opponent = player2;
        player2.opponent = player1;

        const seed = Math.floor(Math.random() * 100000000) + 1;

        player1.gameMode = player2.gameMode;

        player1.socket.send(JSON.stringify({ type: 'match_found', opponentId: player2.id, opponentUsername: player2.username, seed, gameMode: player1.gameMode }));
        player2.socket.send(JSON.stringify({ type: 'match_found', opponentId: player1.id, opponentUsername: player1.username, seed, gameMode: player1.gameMode }));
        queue[queueName] = undefined;
    }
    else {
        queue[queueName] = pl;
    }
    console.log("queue end", queue)
}

function handleLeaving(player: Player | null) {
    console.log("player left:", player?.username)
    if (player) {
        if (player.id == queue[player.queueName]?.id) {
            queue[player.queueName] = undefined;
        }
        if (player.opponent && player.opponent.socket) {
            player.opponent.socket.send(JSON.stringify({ type: 'opponent_left' }));
            player.opponent.opponent = undefined;
            player.opponent = undefined;
        }
    }
}

console.log('Matchmaking server running on ws://localhost:8080');