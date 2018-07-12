Readme for SMS Gateway
from initial notes setup on linode

one time setup
==============
- get the required modules/ options
------------------------------------
	apt-get install nodejs
	apt-get update
	apt-get install git-core curl build-essential openssl libssl-dev
	apt-get install npm
	apt-get install mysql-server 

optional for for tracert
=========================
	apt-get install ndisk6   


Setup required libraries using npm
=========================
	npm init  (to do - create a package.json file, then install the others using --save)
	npm install smpp
	npm install mysql
	npm install nodemailer
	npm install forever-monitor
	npm install nodemailer
	npm install winston
	npm install express --save
	npm install body-parser --save
	npm install nodemailer-smtp-transport --save
	
Local configuration
=========================	
set up the logs directory used by forever-monitor
	mkdir logs
	chmod 777 logs
edit the config.js file for smpp parameters etc

Create database and tables
=========================	
	mysql --user=root --password=as above
	create database smsgw;
	use smsgw;

	create table msg (
	msgIdx INT AUTO_INCREMENT PRIMARY KEY,
	msgID varchar(20),
	msgTS varchar(20),
	msgSrc varchar(20),
	msgDst varchar(20),
	msgState varchar(6),
	msgGW varchar(12),
	msgMsg varchar(180)
	);

	create table http (
	ID INT AUTO_INCREMENT PRIMARY KEY,
	hMsgID varchar(20),
	hType INT,
	hTS varchar(20),
	hMsg varchar(256)
	);

	CREATE USER 'smsgwUsr'@'localhost' IDENTIFIED BY '';
	GRANT SELECT,UPDATE,INSERT ON *.* TO 'smsgwUsr'@'localhost';

Running the server
==================
run the VPN using the startup script
	/etc/vpnc/vconnect.sh

run code for debug
	nodejs smsgw.js
	^C to exit

run code under forever watchdog
	nodejs smsgw_forever.js
	^C to exit

/* *****************************************************************************
 *  SMPP to HTML Gateway
 * A javascript/ nodejs implementation of an smpp to html/other gateway.
 * uses a VPN or other direct connection to talk SMPP to a SMSC for message 
 * receipt and delivery offers an http interface , and others planned to 
 * known client machines posting messages to them and accepting http posts 
 * for message submission.
 *
 *  Initial version HowardT & PhilipL,  February 2015.
 *  Charlie Goldsmith Associates Ltd for GESS and HPF projects South Sudan
 *  projects funded by UK AID.
 *  GESS Consortium Managed by BMB Mott MacDonald
 *  HPF Consortium managed by Crown Agents
 *
 * Copyright (C) 2015 Charlie Goldsmith Associates Ltd
 * All rights reserved.
 *
 * Charlie Goldsmith Associates Ltd develop and use this software as part of its work
 * but the software itself is open-source software; you can redistribute it and/or modify
 * it under the terms of the BSD licence below
 *
 *Redistribution and use in source and binary forms, with or without modification,
 *are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software 
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" 
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR 
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
 * GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) 
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY 
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
 * DAMAGE.
 *
 *for more information please see http://opensource.org/licenses/BSD-3-Clause
 * *****************************************************************************/
