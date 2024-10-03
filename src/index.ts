import { WebSocketServer, WebSocket } from 'ws';

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

interface Match {
    players: Player[]
    gameStarted: boolean;
    gameMode: 1 | 2 | 3;
    queueName: string;
    seed: number;
}

interface Player {
    id: string;
    username: string;
    socket: WebSocket;
    ready: boolean;
    waitingForResult: boolean;
    dead: boolean;
    loot: number;
    points: number;
    reroll: boolean;
    position: "0" | "1" | "2"; //ship, outside, inside
    match?: Match;
    team?: 1 | 2 | 3 | 4;
    teamId?: number;
    playing: boolean;
}

// Create a new WebSocket server
const wss = new WebSocketServer({ port: 8080 });

const queue: { [key: string]: (Match | undefined) } = {};

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
                if (queueName == "" && data.version != "v64") {
                    ws.send(JSON.stringify({ type: 'error', value: "Please use V64 for public queues" }))
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
                if (player && player.socket && player.match) {
                    console.log("in_game_error detected, players match", player.match)
                    player.socket.send(JSON.stringify({ type: "in_game_error" }));
                }
                else {
                    player = {
                        id: data.steamId,
                        username: data.steamUsername,
                        socket: ws,
                        ready: false,
                        loot: 0,
                        waitingForResult: false,
                        dead: false,
                        points: 0,
                        reroll: false,
                        position: "0",
                        playing: false
                    };
                    matchPlayers(player, queueName, gameMode)
                }
                break;

            case 'ready':
                if (player && player.match && player.socket) {
                    player.ready = true;
                    if (player.match.players.every(player => player.ready)) {
                        player.match.players.forEach((pl) => {
                            if (pl.socket) {
                                pl.socket.send(JSON.stringify({ type: 'game_start' }));
                            }
                            else {
                                console.log("player without socket in ready", pl)
                            }
                        })
                    }
                }
                break;

            case 'position':
                if (player && player.match && player.team) {
                    var ship = 0
                    var outside = 0
                    var inside = 0
                    player.match.players.filter(pl => player.team == pl.team).forEach((pl) => {
                        switch (pl.position) {
                            case "0":
                                ship++;
                                break;
                            case "1":
                                outside++;
                                break;
                            case "2":
                                inside++;
                                break;
                        }

                    })
                    player.match.players.forEach((pl) => {
                        if (pl.socket)
                            pl.socket.send(JSON.stringify({ type: 'position', value: data.value, team: player.team, ship, outside, inside }));
                    })
                }
                break;

            case 'score':
                if (player && player.opponent && player.socket && player.opponent.socket && !player.waitingForResult) {
                    player.loot = parseInt(data.value);
                    player.opponent.socket.send(JSON.stringify({ type: 'score', value: data.value }));
                    //End waiting
                    if (player.opponent.waitingForResult && player.opponent.dead && player.loot >= player.opponent.score && player.gameMode == 1) {
                        player.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                        player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        matchEnd(player);
                    }
                    else if (player.opponent.waitingForResult && !player.opponent.score && player.loot && player.gameMode == 1) {
                        player.socket.send(JSON.stringify({ type: 'won', value: "7" }))
                        player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "8" }))
                        matchEnd(player);
                    }
                }
                break;
            case 'death':
                if (player && player.match) {
                    player.dead = true;
                    if (player.match.gameMode == 1) {
                        player.waitingForResult = true;
                    }
                }
                break;

            case 'liftoff':
                if (player && player.match && player.socket) {
                    player.waitingForResult = true;
                    evaluateGameResult(player)
                }
                break;
            case 'eject':
                if (player && player.match && player.socket) {
                    ws.send(JSON.stringify({ type: 'error', value: "Please dont eject" }))
                    handleLeaving(player)
                }
                break;

            case 'chat':
                if (player && player.match && player.socket) {
                    player.match.players.forEach((pl) => {
                        if (pl.socket) {
                            pl.socket.send(JSON.stringify({ type: 'chat', value: data.value }))
                        }
                    })
                    if (data.value == "reroll") {
                        player.reroll = true;
                        if (player.match.players.every(pl => pl.reroll)) {
                            const seed = Math.floor(Math.random() * 100000000) + 1;
                            player.socket.send(JSON.stringify({ type: 'reroll', seed }));
                            player.reroll = false;
                            player.match.players.filter(pl => pl.socket).forEach((pl) => {
                                pl.socket.send(JSON.stringify({ type: 'reroll', seed }));
                                pl.reroll = false;
                            })
                        }
                    }
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
                        if (player.opponent.score > player.loot) {
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        }
                        else if (player.loot > player.opponent.score) {
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
                        if (player.opponent.score == 0 && player.loot) {
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
                        if (player.loot == 0 && player.opponent.score) {
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
                        if (player.opponent.score > player.loot) {
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3" }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "4" }))
                        }
                        else if (player.loot > player.opponent.score) {
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
                matchEnd(player)
            }
            else {
                if (player.opponent) {
                    if (player.dead && player.loot < player.opponent.score) {
                        player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3" }));
                        player.socket.send(JSON.stringify({ type: 'lost', value: "4" }));
                        matchEnd(player);
                    }
                    else if (player.dead && player.loot == player.opponent.score) {
                        player.opponent.socket.send(JSON.stringify({ type: 'won', value: "9" }));
                        player.socket.send(JSON.stringify({ type: 'lost', value: "10" }));
                        matchEnd(player);
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
                        if (player.opponent.score > player.loot) {
                            player.opponent.points++;
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3", yourScore: player.opponent.points, enemyScore: player.points }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "4", yourScore: player.points, enemyScore: player.opponent?.points }))
                        }
                        else if (player.loot > player.opponent.score) {
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
                        if (player.opponent.score == 0 && player.loot) {
                            //Opponent chicked out
                            player.points++;
                            player.socket.send(JSON.stringify({ type: 'won', value: "7", yourScore: player.points, enemyScore: player.opponent?.points }))
                            player.opponent.socket.send(JSON.stringify({ type: 'lost', value: "8", yourScore: player.opponent.points, enemyScore: player.points }))
                        }
                        else {
                            //Only you died
                            player.opponent.points++;
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "1", yourScore: player.opponent.points, enemyScore: player.points }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "2", yourScore: player.points, enemyScore: player.opponent?.points }))
                        }
                    }
                }
                else {
                    if (player.opponent.dead) {
                        if (player.loot == 0 && player.opponent.score) {
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
                        if (player.opponent.score > player.loot) {
                            player.opponent.points++;
                            player.opponent.socket.send(JSON.stringify({ type: 'won', value: "3", yourScore: player.opponent.points, enemyScore: player.points }))
                            player.socket.send(JSON.stringify({ type: 'lost', value: "4", yourScore: player.points, enemyScore: player.opponent?.points }))
                        }
                        else if (player.loot > player.opponent.score) {
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
                        player.waitingForResult = false;
                        player.opponent.waitingForResult = false;
                        player.reroll = false;
                        player.opponent.reroll = false;
                        player.dead = false;
                        player.opponent.dead = false;
                        player.socket.send(JSON.stringify({ type: 'match_found', opponentId: player.opponent.id, opponentUsername: player.opponent.username, seed, gameMode: player.gameMode }));
                        player.opponent.socket.send(JSON.stringify({ type: 'match_found', opponentId: player.id, opponentUsername: player.username, seed, gameMode: player.gameMode }));
                    }
                    else {
                        console.log("opponent left furing the 1s cooldown")
                    }
                }, 1000)
            }
            break;
    }
}

function matchEnd(match: Match | undefined) {
    console.log("ending match");
    if (match) {
        match.players.forEach(pl => {
            pl.match = undefined
        })
        queue[match.queueName] = undefined;
        match = undefined;
    }
}

function matchPlayers(pl: Player, queueName: string, gameMode: 1 | 2 | 3) {
    console.log("queue start", queue)
    var match = queue[queueName]
    if (match) {
        match.players.push(pl)
    }
    else {
        match = { gameMode, gameStarted: false, players: [pl], queueName, seed: Math.floor(Math.random() * 100000000) + 1 }
    }
    //Send queue information
    //TODO: finish asi posilat arreye hracu
    match.players.filter(pl => pl.socket).forEach(pl => {
        pl.socket.send(JSON.stringify({ type: 'match_info', players: getSendablePlayerArray(match?.players), seed: match?.seed, gameMode: match?.gameMode }));
    })
    // const player2 = queue[queueName];
    // if (player2) {
    //     const player1 = pl;

    //     player1.opponent = player2;
    //     player2.opponent = player1;

    //     const seed = ;

    //     player1.gameMode = player2.gameMode;

    //     player1.socket.send(JSON.stringify({ type: 'match_found', opponentId: player2.id, opponentUsername: player2.username, seed, gameMode: player1.gameMode }));
    //     player2.socket.send(JSON.stringify({ type: 'match_found', opponentId: player1.id, opponentUsername: player1.username, seed, gameMode: player1.gameMode }));
    //     queue[queueName] = undefined;
    // }
    // else {
    //     queue[queueName] = pl;
    // }
    console.log("queue end", queue)
}

//TODO: test if player.match is by reference or value
function handleLeaving(player: Player | null) {
    console.log("player left:", player?.username)
    if (player && player.match) {
        const index: number | undefined = queue[player.match.queueName]?.players.findIndex(pl => { pl.id == player.id })
        if (index && index != -1) {
            player.match.players.splice(index, 1)
            const numPlayers = player.match.players.filter(pl => pl).length
            if (numPlayers) {
                player.match.players.forEach(pl => {
                    if (pl.socket && pl.match) {
                        pl.socket.send(JSON.stringify({
                            type: 'opponent_left',
                            game_ended: numPlayers < 2,
                            players: getSendablePlayerArray(pl.match.players)
                        }))
                    }
                })
                if (numPlayers < 2) {
                    queue[player.match.queueName] = undefined;
                }
            }
            else {
                console.log("NUMPLAYERS IS UNDEFINED!!!!!!")
            }
        }
    }
}

function getSendablePlayerArray(players: Player[] | undefined) {
    if (players) {
        return players.map(pl => { pl.username, pl.id, pl.team, pl.teamId })
    }
    else {
        return []
    }
}

console.log('Matchmaking server running on ws://localhost:8080');