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

// HTML INBOUND SERVER / API Server
// included as part of smsgw.js
// calling formats
// GET /send/API/DST/MSG
// GET /send?API=api&DST=dst&MSG=msg
// POST json or urlenc { API: api, DST: dst, MSG: msg };

// to do list Feb 15
// get https server starting 
// json array of messages to send in post

var express = require('express');
var https = require('https');
var http = require('http');
var url = require('url');

var app = express();
var bodyParser = require('body-parser');

// pick up config file
// replaced by global config for more persistence var config = require('./config');

// internal vars
var smppSendFn = null;
var wlog = null;
var eml=null;
var httpServer= null;
var httpsServer= null; 
var rateChk = [];
var rateChk = [];
var lastMsgTime= new Date();
var rateChkCount = 0;

// register middleware
function initMiddleware()
{
	wlog.log('silly',"SMSGW Loading API Load middleware");  
	
	app.use( function (req, res,next)
		{
			var now =new Date();
			
			// generic rate check - overall rate of hits in 10s
			// if too high then give status 500 replies quickly to reduce load
			if ( (now-lastMsgTime) < 10000 )
			{
				// number of messages without a ten second gap..
				rateChkCount++;
				
				if ( rateChkCount >= 100  )
				{
					// one or two is fine, favicon & page, but 10 requests asecond sustained for 10 seconds!
					if ( rateChkCount == 100 || rateChkCount == 500 )
					{
						var body ="Rate limiter All messages triggered, count of request in last 10s is " + rateChkCount +"\n";
						wlog.warn( body );
						eml.sendEmail ( "SMSGW " + config.Name + ": HTTP server busy ",body , config.AlertEmailTo );  
					}
					// sleep won't help, we need to clear out quick ! sleep(100);
					res.status(500).send("Server overloaded. try again later"); 
					lastMsgTime=now;// last msg
					return;// no next
				}
				// drop through
			}
			else
			{
				// 10 s gap since last request - reset error & count
				if ( rateChkCount >= 100 )
				{
					// stand down
					var body ="Rate limiter is now ok, more than 10s have elapsed since last message\nPeak rate " + rateChkCount +"\n";
					wlog.warn( body );
					eml.sendEmail ( "SMSGW " + config.Name + ": HTTP server now ok ", body, config.AlertEmailTo );  
				}
				rateChkCount=0;
			}
			lastMsgTime=now;

			
			// rate checks per IP address
			// note api key checks have a delay
			// but denial of service might need a throughput limiter
			var ip = req.header('x-forwarded-for') || req.connection.remoteAddress;
			
			if ( ip == undefined)
			{
				// done 
				wlog.error ("Rate limiter cannot determine inbound ip address" );
				res.status(500).send("Cannot determine inbound ip"); 			
				return;
			}
			
			// mechanism for blocking IP addresses
			if ( config.apiKey[ip] != undefined )
			{
				if (config.apiKey[ip] == 'blocked')
				{
					wlog.warn("Access blocked for IP address "+ ip );
					res.status(500).send("Connection refused");
					return; // no next here
				}
			}
			
			if ( rateChk[ip] == undefined )
				rateChk[ip] = { t : now, count: 0};
			else if ( (now - rateChk[ip].t )  < 100 )
			{
				rateChk[ip].count++;
				if (rateChk[ip].count > 25)
				{
					wlog.warn("Rate limiter for " + ip + " ERR, last was " + (now - rateChk[ip].t ) + "ms ago, no msgs rx=" + rateChk[ip].count+": 500" );
					res.status(500).send("Server overloaded. try again later"); 					
					return; // no next here
				}
				if (rateChk[ip].count > 5)
				{
					wlog.warn("Rate limiter for " + ip + " DELAY, last was " + (now - rateChk[ip].t ) + "ms ago, no msgs rx=" + rateChk[ip].count+": DELAY" );					
					sleep(100);					
				}	
			}
			else
			{
				if (rateChk[ip].count > 25)
				{
					wlog.info("Rate limiter for " + ip + " is now ok, last was " + (now - rateChk[ip].t ) + "ms ago" );				
				}				
				rateChk[ip].count=0;
			}
			rateChk[ip].t = new Date();
			
			next();
		}
	);
	
	// handler for files in public directory like favicon etc
	app.use(express.static('public'));
	app.use(bodyParser.json()); // for parsing application/json
	app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
	
	// route get & post with send verb to send handler
	app.all('/send*', function (req, res,next)
		{
			handleSendRequest(req, res);
			// next not used.. handling stops here
		}
	);

	// and finally.. the catch all
	app.all('*', function (req, res,next)
		{
			wlog.silly("Final catch all server 404 reply for " + req.url );
			res.status(404).send("Not found or argument not handled"); 
			// next not used.. handling stops here
		}
	);
}

function handleSendRequest (req, res)
{
	// handle various forms of call
	// to do a json array of messages to send..
	if ( req.method == 'GET')
	{
		var urlArg = req.url.split('/');
		//wlog.silly("API GET Check number of args " + urlArg.length + " ", urlArg);
			
		if ( urlArg.length == 5 || urlArg.length == 6 )
		{
			// format 1
			// send/apikey/dest/message
			// http://178.79.165.118:8888/send/asjhksahjksajhk/<dst>/msg
			if ( urlArg[0] == "" &&
				 (urlArg[1] == "send" || urlArg[1] == "SEND")  )
			{
				wlog.info( "HTTP Get call format 1 " + req.url );
				validateSendRequest( req,res, urlArg[2], urlArg[3], urlArg[4]);
				// done - do not call next
				return;
			}
		}
		else
		{
			if ( req.url.IndexOf ("/send?")== 0 )
			{
				wlog.silly("API GET check format 2 " + req.url );
				var arg = url.parse( req.url );
				// format 2
				if (typeof arg.API != undefined &&
				    typeof arg.DST != undefined &&
				    typeof arg.MSG != undefined ) 
				{
					// API , DST and MSG as parameters in url
					// we have minimum args - validate them and send
					wlog.info( "HTTP Get call format 1 " + req.url );
					validateSendRequest( req,res, urlArg[2], urlArg[3], urlArg[4]);
					return;				
				}
				wlog.silly("API GET check format 2 failed " , arg );
				
			}
			else
			{
				wlog.warn("API GET can't determine format " + req.url );				
			}
		}

		// should not get here we're registered on the send verb !
		wlog.info( "HTTP invalid GET call " + req.url );
		res.status(500).send("Error  121: refer to manual"); // unhelpful error
		return;
	}// end of get
	
	if ( req.method == 'POST')
	{
		// pick up post args API, DST and MSG
		if (!req.body)
		{
			wlog.info( "HTTP invalid POST call, no arguments /body found ");
			res.status(500).send("Error  101: refer to manual"); // unhelpful error
			return;
		}
		else if ( typeof req.body.API != 'undefined' &&
				  typeof req.body.DST != 'undefined' &&
				  typeof req.body.MSG != 'undefined' ) 
		{
			// API , DST and MSG as post args json or urlenc
			// we have minimum args - validate them and send
			wlog.info( "HTTP valid POST call ", req.body);
			validateSendRequest( req,res, urlArg[2], urlArg[3], urlArg[4]);
			return;
		}

		// post parameters wrong/ missing
		wlog.info( "HTTP invalid POST call, invalid or missing arguments ", req.body);
		res.status(500).send("Error  102: refer to manual"); // unhelpful error
		return;
	}// end post

	// unhandled method call - unhelpful error
	wlog.info( "HTTP unhandled method call for send " + req.method);
	res.status(500).send("Error  125: refer to manual"); // unhelpful error
	
}

function validateSendRequest ( req,res, apiKey,dst, msg)
{
	// send requests offered in many forms, most have api key and a dst + msg
	// this is the general handler.. with unhelpful responses for failure to make hacking a little harder
	// validate api key
	if ( ValidateAPIKey( apiKey, req))
	{
		if ( dst.length < 4 || 
			 dst.length > 24 || 
			! isNumber(dst) )
		{
			wlog.info( "Send argument error: invalid destination " + dst);
			res.status(500).send("Error  119: refer to manual"); // unhelpful error
		}
		else if ( msg.length < 2 || 
			 msg.length > 256 ) // arbitary upper limit 
		{
			wlog.info( "Send argument error: invalid message length (2-256)" + msg.length);
			res.status(500).send("Error  120: refer to manual"); // unhelpful error
		}
		else
		{
			// good to go
			wlog.info( "Send request OK: {Dest:"+ dst +",MSG: " + msg + "}");
			smppSendFn( dst,msg);
			res.set({"Content-Type": "text/plain"});
			res.send("OK"); // helpful error
		}
	}
	else
	{
		wlog.info( "Send request Error invalid API key " + apiKey);
		res.status(500).send("Error  118: refer to manual"); // unhelpful error
	}
	// no next - this is the last we do to the message
}


function isNumber(n)
{
  return !isNaN(parseFloat(n)) && isFinite(n);
}


function ValidateAPIKey( apiKey, req)
{
	// ultra simple API key check - api key vs static ip of calling host
	// assumes incoming requests are from a static IP, which is likely in the
	// initial usage , but may break in future..
	
	// read header, or proxy original if forwarded
	var ip = req.header('x-forwarded-for') || req.connection.remoteAddress;
	
	if ( ip == undefined)
	{
		wlog.error( "Check API key FAILED to find IP address of incoming request, API check fail ", req.header );
		return false;
	}
	
	if ( apiKey == undefined)
	{
		wlog.error( "Check API key FAILED CODING ERROR undefined api key handed to validator" );
		return false;
	}
	
	// slow down bad boys attempt to find a good api key
	
	if ( typeof config.apiErr[ip] == 'undefined')
	{
		// init error count
		config.apiErr[ip] = 0;
	}
	
	// does the ip address exist in our config file..
	if ( config.apiKey[ip] != undefined )
	{
		// yes - what is the proper key
		var tstKey = config.apiKey[ip];
		
		//wlog.log('debug',"Key on file for "+ip+" is '" + apiKey + "'" );
		if ( tstKey === apiKey)
		{
			if ( config.apiErr[ip] >= 5 )
			{
				var body ="API checker OK, IP Address "+ ip +" has submitted the correct key\n after " + config.apiErr[ip]+ " attempts" ;
				wlog.warn( body );
				eml.sendEmail ( "SMSGW " + config.Name + ": HTTP API ok",body , config.AlertEmailTo );  
			}

			config.apiErr[ip] =0;// reset error count
			//wlog.log('silly',"API Key OK  '" + apiKey + "' from " + ip );  
			return true;
		}
		
		if( config.apiErr[ip] > 1 )
		{
			// we could auto block by setting their API to 'blocked'
			// retries get a delay
			var n= 2 + Math.floor(Math.random(5.1)); // 2-7 seconds should be enough 
			wlog.log('debug',"BAD ip address, delay " + n + " milliseconds before reply" );
			config.apiErr[ip] ++;	// up err count before delay/email send..
			sleep(n);// sleep for n seconds
			
			// to many retries is alertable
			if ( config.apiErr[ip] == 5 || (config.apiErr[ip]%1000) == 999)
			{
				var body ="API checker error,"+ config.apiErr[ip] +" repeated API key failures from IP address "+ ip + "\n";
				wlog.warn( body );
				eml.sendEmail ( "SMSGW " + config.Name + ": HTTP API errors",body , config.AlertEmailTo );  
			}
			return false;// so we don't double inc erro count
		}
		// bad request from ip, probably just a setup error
		// give a helpful warning in the logs
		wlog.warn( "Error in API Key submitted for "+ip + " correct API key is '" + tstKey +"',error count " + config.apiErr[ip]);
	}
	else
	{
		// unknown ip having it on
		wlog.log('debug',"No Key on file for "+ip + ",error count " + config.apiErr[ip]);
	}	
	
	// increment the API error count for this ip
	config.apiErr[ip] ++;	
	
	return false;
}

// sleep and sleep-thread packages refused to compile with nodejs we used on original linode server// so roll-yr-own applies
// blocking sleep function
function sleep( ms )
{
	var start = new Date();
	var i=0;
	var safety = ms * 10000;
	do
	{
		i++;
		var now = new Date();
	} while ( (now-start) < ms && i < safety );
	if ( i >= safety )
	{
		// wow server was fast or algorithm didn't work
		wlog.error("Sleep function safety count exceeded in delay of " + ms +"ms, after " + (now-start));
	}
}

exports.end = function( )
{
	if ( httpServer != undefined )
	{
		httpServer.close();
		httpServer = undefined;
	}
}

// main class creator/ call to kick the server off..
exports.StartServer = function(send_fn, wlogger, emailer )
{
	smppSendFn=send_fn;
	wlog = wlogger;
	eml = emailer;
	wlog.log('silly',"SMSGW Loading API Init");  
	
	initMiddleware();

	wlog.log('silly',"SMSGW Loading API Start http server");  
	
	httpServer= http.createServer(app).listen(config.httpPort);

	httpServer.on('close',  function()
		{
			wlog.info("HTTP Server closed");
		});
	httpServer.on('log',  function(msg)
		{
			wlog.info("HTTP Server " , msg);
		});
		
	//wlog.log('silly',"SMSGW Loading API Start https server");  
	// todo - options needed, just bombs out on call 
	// httpsServer= https.createServer(config.httpsOptions,app).listen(config.httpsPort);
	
	/*wlog.log('API servers listening at http://%s:%s  and  https://%s:%s',
		httpServer.address().address, 
		httpServer.address().port,
		httpsServer.address().address, 
		httpsServer.address().port);*/
	wlog.log('SMS Loading API Started, listening at http://%s:%s ',
		httpServer.address().address, 
		httpServer.address().port);
	
}