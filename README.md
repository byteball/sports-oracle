# Sports oracle

This oracle retrieves results of several sports and posts them into Byteball as a data feed.  

The data is sourced from :
- [football-data.org](http://api.football-data.org/index) 
- [mysportsfeeds.com](https://www.mysportsfeeds.com/) 

Many thanks to them !

Data posted by this oracle is used in betting contracts, the contract can be unlocked by the winning party. See https://medium.com/byteball/making-p2p-great-again-episode-iii-prediction-markets-f40d49c0abab.

To unlock a contract, user opens a chat with this oracle (the link is available at [byteball.org](https://byteball.org/)) and look for a fixture. After he chooses a fixture the oracle posts the result in database and sends a notification when the data feed unit is confirmed, the backer can unlock the contract if he correctly predicted the outcome of the game. Otherwise, the layer can unlock the contract after the contract expires.

Visit our wiki for more information: [https://wiki.byteball.org/Sports_betting](https://wiki.byteball.org/Sports_betting)
