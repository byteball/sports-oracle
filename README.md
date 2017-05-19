# Sports oracle

This oracle retrieves results of football matches and posts them into Byteball as a data feed.  The data is sourced from [football-data.org](http://api.football-data.org/index).

Data posted by this oracle is used in betting contracts, the contract can be unlocked by the winning party. See https://medium.com/byteball/making-p2p-great-again-episode-iii-prediction-markets-f40d49c0abab.

To unlock a contract, user opens a chat with this oracle (the link is available at [byteball.org](https://byteball.org/)) and types the names of the teams.  The oracle fetches data from football-data.org and posts the data feed.  After the data feed unit is confirmed, the backer can unlock the contract if he correctly predicted the outcome of the game.  Otherwise, the layer can unlock the contract after the contract expires.
