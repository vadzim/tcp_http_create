# tcp_http_proxy

Sometimes only such tcp<->http tunnel works.

on your client side run:

`npx tcp_http_proxy.ts client http://localhost:9280/ 9229`

you'll get your key:

`Client: forwarding 9229 to http://localhost:9280/JHJnTxu9fPCAjd`

then get you public address:

`ngrok http 9280`

you'll see

`https://b65962bb50a3.ngrok-free.app -> http://localhost:9280`

so you can construct your oublic url:

`https://b65962bb50a3.ngrok-free.app/JHJnTxu9fPCAjd`

use it to run on server side:

`npx tcp_http_proxy.ts server 9229 https://b65962bb50a3.ngrok-free.app/JHJnTxu9fPCAjd`

now your local port 9229 port is connected to the 9229 port on your server.
