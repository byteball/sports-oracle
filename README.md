# Flight delays oracle

This oracle monitors flight delays and posts the data into Byteball as a data feed.  The data is sourced from [FlightStats](https://developer.flightstats.com/api-docs/flightstatus/v2/flightstatusresponse).

Data posted by this oracle is used in flight delay insurance contracts, the contract can be unlocked by the insured if the flight arrived more than X minutes late, or by the other party otherwise. See https://medium.com/byteball/making-p2p-great-again-episode-iv-p2p-insurance-cbbd1e59d527.

To unlock a contract, user first opens a chat with this oracle (the link is available at [byteball.org](https://byteball.org/)), types his flight number and the date.  The oracle fetches data from FlightStats and posts the data feed.  After the data feed unit is confirmed, the user can unlock the contract.
