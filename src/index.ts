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
    queueName: string;
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

        switch (data.type) {
            case 'register':
                if (player && player.socket && (player.opponent || queue[player.queueName])) {
                    console.log(queue)
                    player.socket.send(JSON.stringify({ type: "in_game_error" }));
                }
                else {
                    var queueName = data.queueName ? data.queueName : ""
                    player = { id: data.steamId, username: data.steamUsername, socket: ws, ready: false, score: 0, waitingForResult: false, dead: false, queueName };
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
                    if (player.opponent.waitingForResult && player.opponent.dead && player.score >= player.opponent.score) {
                        player.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                        player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        gameEnd(player);
                    }
                    else if (player.opponent.waitingForResult && !player.opponent.score && player.score) {
                        player.socket.send(JSON.stringify({ type: 'won', value: "7" }))
                        player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "8" }))
                        gameEnd(player);
                    }
                }
                break;
            case 'death':
                if (player && player.socket && player.socket && player.opponent?.socket) {
                    player.dead = true;
                    player.waitingForResult = true;
                    evaluateGameResult(player)
                }
                break;

            case 'liftoff':
                if (player && player.opponent && player.socket && player.opponent.socket) {
                    player.waitingForResult = true;
                    evaluateGameResult(player)
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
}

function gameEnd(player: Player) {
    if (player && player.opponent) {
        player.opponent.opponent = undefined
        player.opponent = undefined
    }
}

function matchPlayers(pl: Player, queueName: string) {
    console.log("queue", queue)
    const player2 = queue[queueName];
    if (player2) {
        const player1 = pl;

        player1.opponent = player2;
        player2.opponent = player1;

        const seed = Math.floor(Math.random() * 100000000) + 1;

        player1.socket.send(JSON.stringify({ type: 'match_found', opponentId: player2.id, opponentUsername: player2.username, seed }));
        player2.socket.send(JSON.stringify({ type: 'match_found', opponentId: player1.id, opponentUsername: player1.username, seed }));

        queue[queueName] = undefined;
    }
    else {
        queue[queueName] = pl;
    }
}

function handleLeaving(player: Player | null) {
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