#!/bin/bash
# start the VPN to vivacel .. with an idle time set by --dpd-idle
vpnc --dpd-idle 600 /etc/vpnc/vivacell.conf
# reset the main gateway to the public Ip so we don't route everything down the vpn
route add default gw 178.79.165.1
# and remove the default route down the tunnel 
route del default dev tun0
# replace it with a specific static route to the vivacel network
# if we need to be more specific the servers are 172.16.1.10 and .11
route add -net 172.16.0.0 netmask 255.255.0.0 dev tun0

