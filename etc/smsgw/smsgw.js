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

/* this is the main file, 
 * it can be run directly 
 *    nodejs smsgw.js
 * or through the persistenmce / watchdog module
 *    nodejs smsgw_forever.js
 */

 /*
  * Todo list : Feb 15
  * email alerts on failures/ repeats/ high rates of send
  * handle user data heads and recombine into message for delivery
  * handle/ split long outbound messages
  */
'use strict';
 
var ver = "1.01 Apr 2015";

// parameters
var cfg = require('./config');
// load then save to global to allow reload later
global.config = cfg;// init a global all modules can use..

// main includes
var smpp = require('smpp');
var httpsrv = require('./smsgw_api');
var mysql   = require('mysql');
var dbconn  = null;
var http = require('http');
var querystring = require('querystring');
var events = require('events');
var wlog = require("./logger");
var spawn = require('child_process').spawn;

// With log(...)
wlog.info("SMSGW Starting " + config.Name );

// -----------------------------------------------------------------
// Startup - start sessions, connect db, start http server etc.
// -----------------------------------------------------------------

//---------- initialising emailer
wlog.log('silly',"SMSGW Starting Loading EMAIL");  
var eml = require('./emailer');
wlog.log('silly',"SMSGW Starting Init EMAIL");  
eml.StartEmail(wlog);

//---------- initialising database
wlog.log('silly',"SMSGW Loading database");  
//https://github.com/felixge/node-mysql for options
var mp = config.mysql_pwd;
var p = mp.substr(1,mp.length-1); // yeah yeah, but it's one layer of security

var dbconn = mysql.createConnection({
  host     : config.mysql_host,
  user     : config.mysql_user,
  password : p,
  database : config.mysql_db
});

wlog.log('silly',"SMSGW Loading event emitter");  
var eventEmitter = new events.EventEmitter();


var session = null;		// current smpp session, set to null on exit

// start the http server
// with callback for the smpp session to send ad-hoc messages
wlog.log('silly',"SMSGW Loading http server");  
httpsrv.StartServer( SendSMS, wlog , eml);

// start database
wlog.log('silly',"SMSGW Connect database");  
dbconn.connect();
wlog.info("Database connection started " + config.mysql_host);

/*wlog.info("Testing Database connection ");
dbconn.query("SELECT MAX(msgIdx) AS maxIdx FROM msg WHERE msgGW='" + config.Prefix + "';", 
			function(err, rows, fields)
			{
				if (err) throw err;
				wlog.info("Testing Database ok :"+ rows[0].maxIdx );
			}
		);*/

// event router for incoming SMS messages after they have been saved and a msgID worked out..
eventEmitter.on('pdusaved', function(pdu,msgID)
		{
			wlog.debug("PDU Saved Event " + pdu.command + " msg ID "+ msgID );
			if ( pdu.command === 'deliver_sm' && pdu.command != 'deliver_sm_resp')
			{
				HandleIncomingSMS ( pdu ,msgID);
			}
		});


// HT Apr 15 reset comms link shell call
if ( config.run_reset_script_at_start > 0 )
{
	ResetCommLink();
}

// -----------------------------------------------------------------
// MAIN Timer loop - watchdog on the smpp connection which can reset 
var watchdog =  setInterval( 
	function fn ()
	{
		
		if ( config.connection_reset_count >= config.connection_reset_limit)
		{
			var body= "Watchdog has restarted SMPP " + config.connection_reset_count + " times, exiting";
			eml.sendEmail ( "SMSGW " + config.Name + ": Exit on error ", body, config.AlertEmailTo );  
			wlog.log('warn',body);
			// stop watchdog timer - the main reset loop driver
			clearInterval(watchdog);
			// but exit in 5 to give the warning email a chance to go..
			wlog.log('warn',"Start shutdown process.");
			DoShutdown();
			// and give em a decent time to die
			setInterval( 
				function exitfn ()
				{
					wlog.log('warn',"SMSGW Exiting");
					process.exit(1);
				}, 5000
			);
			return;
		}
				
		if ( session == null )
		{
			// retry connection
			
			// -----------------------------------------------------------------
			// MAIN SMPP protocol object 
			// clear session on close to allow watchdog interval to restart
			if ( (config.connection_reset_count % 2) == 0 || config.smpp_server2.length ==0)
			{
				wlog.log('warn',"Starting SMPP connection to "+ config.smpp_server + ":" + config.smpp_port);
				session= smpp.connect(config.smpp_server, config.smpp_port);				
			}
			else
			{
				wlog.log('warn',"Starting SMPP connection to "+ config.smpp_server2 + ":" + config.smpp_port2);
				session= smpp.connect(config.smpp_server2, config.smpp_port2);				
			}
			
			// HT Apr 15 call reset script if configured..
			if ( (config.connection_reset_count%2)==1 && config.connect_reset_script.length >0 )
			{
				ResetCommLink();
			}
			
			
			// send bind transceiver using shortcut method after connection
			// session.bind_transceiver( options, callback)
			// interface version 52 - hex 34 is essential for vivacel rss
			session.bind_transceiver({
					system_type: 'ESME',
					address_range: config.smpp_number,
					interface_version: 52,
					system_id: config.smpplogin,
					password: config.smpppwd
				}, 
				function(pdu) 
				{
					if (pdu.command_status == 0)
					{
						// Successfully bound 
						wlog.info("SMPP Bind successful, session has started.");
						config.failed_enq_link_count=0;
						//var body= "SMSGW started ok\n Server time is "+ GetTs();
						//eml.sendEmail ( "SMSGW " + config.Name + ": Startup OK ", body, config.AlertEmailTo );  
					}
					else
					{
						wlog.log("error","SMPP Bind Failed.\n ", pdu);
					}
				});

				
			// on error
			session.on('error', function(err){
					// handle the error safely
					wlog.log("error", "Session ERROR:" + err.syscall + ", code="+ err.code );
					
					if ( session != null )
					{
						session.close();
					}
				});
			
			// on close
			session.on('close', function() {
				config.connection_reset_count++;
				
				wlog.info("SMPP Session closed "+ config.connection_reset_count );
				session = null;
				
			});
			// on start
			session.on('connect', function() {
				wlog.info("SMPP Session started "+ config.connection_reset_count );
			});
			// on send
			session.on('send', function(pdu) {
				var pduDecode = pdu;
				pduDecode._filter('decode');
				if ( config.showPDUs != 0 ) wlog.log('debug',"SMPP SEND:  ", pduDecode );
				if ( pdu.command == 'submit_sm' )
				{
					SavePDU(pduDecode, "TX");
				}
				
			});
			// on receive
			session.on('receive', function(pdu) {
				if ( config.showPDUs != 0 ) wlog.log('debug',"SMPP RX: ", pdu );
			});
			// on receive unknown
			session.on('unknown', function(pdu) {
				wlog.log("error","SMPP RX UNKNOWN:  ", pdu );
				session.send(pdu.response());// send generic NACK
			});

			// on unbind - sent from the other end (rare)
			session.on('unbind', function(pdu) {
				wlog.info("SMPP Unbind received");
				session.send(pdu.response());
				session.close();
			});

			// enquire_link recievd - respond to ping
			session.on('enquire_link', function(pdu) {
				wlog.debug("SMPP Enq link received");
				session.send(pdu.response());
			});

			// _---------------------------------------------------
			// Main point for receipt of inbound SMS messages
			// store & respond
			session.on('deliver_sm', function(pdu) {
				SavePDU(pdu,"RX");
				// causes event emiiter pdusaved - 
				// where the HandleincomingSMS is handled
				// which sends the pdu response
			});

		}
		else
		{
			// timer fires and session is ok,
			config.enq_link_standoff++;
			if ( config.enq_link_standoff >= config.enq_link_every)
			{
				// send an enquire link - no pdu arguments
				session.enquire_link({
					dummy: 'dummy'
					}, function(pdu)
					{
						if (pdu.command_status == 0)
						{
							// Successfull enq link
							wlog.debug("SMPP Link ok.");
							config.failed_enq_link_count=0;
							config.enq_link_standoff=0;
						}
						else
						{
							config.failed_enq_link_count++;
							wlog.log("error","SMPP Enq link fail. " + config.failed_enq_link_count);
							if ( config.failed_enq_link_count > config.failed_enq_link_limit )
							{
								wlog.log("error","SMPP too many enq link errors : reset session ");
								session.close();
							}
						}
					});
			}
		}
	}, config.watchdog_interval); // re-try bind or enq_link every 10 sec


/* ************************************************************************************* */
// Top level inbound sms handler
/* ************************************************************************************* */
function HandleIncomingSMS ( pdu, msgID )
{
	wlog.info("SMPP SMS received " + pdu.short_message + " [" + msgID+"]" );
	
	if ( config.showPDUs) wlog.log('debug',"SMPP SMS RX PDU " , pdu);
	
	// store inbound pdu and give id
	// detect user data header for multi-part messages
	var msg_complete=0;
	var udh=0;
	/* detect udh headers
	// http://en.m.wikipedia.org/wiki/User_Data_Header
	// http://en.m.wikipedia.org/wiki/Concatenated_SMS
	Field 1 (1 octet): Length of User Data Header, in this case 05.
	Field 2 (1 octet): Information Element Identifier, equal to 00 (Concatenated short messages, 8-bit reference number)
	Field 3 (1 octet): Length of the header, excluding the first two fields; equal to 03
	Field 4 (1 octet): 00-FF, CSMS reference number, must be same for all the SMS parts in the CSMS
	Field 5 (1 octet): 00-FF, total number of parts. The value shall remain constant for every short message which makes up the concatenated short message. If the value is zero then the receiving entity shall ignore the whole information element
	Field 6 (1 octet): 00-FF, this part's number in the sequence. 
	
	deliver_sm pdu contains (from smpp/defs.js)
			service_type: {type: types.cstring},
			source_addr_ton: {type: types.int8},
			source_addr_npi: {type: types.int8},
			source_addr: {type: types.cstring},
			dest_addr_ton: {type: types.int8},
			dest_addr_npi: {type: types.int8},
			destination_addr: {type: types.cstring},
			esm_class: {type: types.int8},
			protocol_id: {type: types.int8},
			priority_flag: {type: types.int8},
			schedule_delivery_time: {type: types.cstring, filter: filters.time},
			validity_period: {type: types.cstring, filter: filters.time},
			registered_delivery: {type: types.int8},
			replace_if_present_flag: {type: types.int8},
			data_coding: {type: types.int8},
			sm_default_msg_id: {type: types.int8},
			//sm_length: {type: types.int8},
			short_message: {type: types.buffer, filter: filters.message}
	*/
	var combinedmsg="";
	var TS = GetTS();
	var msgSrc = pdu.source_addr;
	
	if ( udh )
	{
		// is message complete ?
		// else store for later
		msg_complete=1; // for testing
		combinedmsg = pdu.short_message.message;
	}
	else
	{
		// single message, message is complete
		msg_complete=1;
		combinedmsg = pdu.short_message.message;
	}
	
	if ( msg_complete )
	{
		// iterate through the configured clients..
		var arrayLength = config.msg_delivery.length;
		for (var i = 0; i < arrayLength; i++)
		{	
			var delivConfig = config.msg_delivery[i];
			
			var numberMask = delivConfig.nmask;
			var msgMask = delivConfig.mmask;
			var bHit = true;
			
			if ( numberMask != '*')
			{
				// match on source number 
				bHit = numberMask.text(pdu.source_addr);
			}
			if ( bHit && msgMask != '*')
			{
				// match on source number 
				bHit = msgMask.text( combinedMsg );
			}
			
			if ( bHit )
			{
				if ( delivConfig.type == 0)
				{
					// mask = text at header to match for this route
					// std auto.pl sssams call, http post
					wlog.debug("SMPP outbound route "+ i + " SSSAMS original format " + delivConfig.host +delivConfig.path );
					
					var post_data = querystring.stringify({
						  'CP' :  delivConfig.CP,
						  'DB' :  delivConfig.DB,
						  'MID' :  delivConfig.MID,
						  'MT' :  'MSG',
						  'M' : combinedmsg,
						  'TS' : TS,
						  'S' : msgSrc,
						  'GW' :   delivConfig.GW
					  });
					  
					var post_options = {
					  host: delivConfig.host,
					  path: delivConfig.path,
					  port: '80',
					  method: 'POST',
					  headers: {
						  'Content-Type': 'application/x-www-form-urlencoded',
						  'Content-Length': post_data.length
					  }
					};

					// Set up the request
					var post_req = http.request(post_options, function(res) {
						var hMsgID = msgID;
						var hSrc = msgSrc;
						var hType = delivConfig.type;
						res.setEncoding('utf8');
						res.on('data', function (chunk) {
							wlog.info("HTTP Response for "+hMsgID+": " + chunk);
							// save it..
							SaveHTTPReply( hType, hMsgID, chunk );
							// process into replies..
							ProcessSSSAMSReply( hSrc ,chunk );
						});
					});

					// post the data
					wlog.debug ("Send FORM POST to "+ delivConfig.host + ":" + post_data);
					post_req.write(post_data);
					post_req.end();
					wlog.debug ("FORM POST to "+ delivConfig.host + ": done");
					
				}
				else if ( delivConfig.type == 1)
				{
					// dummy call for testing
					wlog.info("SMPP outbound route "+ i + " test " + delivConfig.url );
					
				}
				else
				{
					wlog.log("error","SMPP outbound route "+ i + " ERROR unknown route type ");
				}
			}
			else
			{
				wlog.info("SMPP outbound route "+ i + " message filters not matched");
			}
		}
	}
	// send response
	session.send(pdu.response({	message_id: msgID }) );	
}

/* ************************************************************************************* */
// Call back function for http handler etc. to send a message out
/* ************************************************************************************* */
function SendSMS( dest, message )
{
	var msgRef="";
	
	if ( session == null ) return msgRef;
	
	var ton = 0; // unknown
	var npi = 1;
	if ( dest.indexOf('+') == 0)
	{
		ton =1;
		npi =1;
		dest = dest.substr(1,dest.length-1);
	}
	else if ( dest.indexOf('0') == 0)
	{
		ton =2;// national ie leading 0
		npi =1;
	}
	
	var srcton = 0;
	var srcnpi = 1; // default msisdn
	var src = config.smpp_number;
	if ( src.indexOf('+') == 0)
	{
		srcton =1;
		srcnpi =1;
		src = src.substr(1,src.length-1);
	}
	else if ( src.indexOf('0') == 0)
	{
		srcton =2; // national leading 0
		srcnpi =1;
		src = src.substr(1,src.length-1);
	}
	else if( src.length < 6 )
	{
		// shortcode
		srcton =2; // as used by vivacel for 6363 but should be 3 network specific
		srcnpi =1;		
	}
	
	session.submit_sm({
			source_addr_ton: srcton,
			source_addr_npi: srcnpi,
			source_addr: src,
			dest_addr_ton: ton,
			dest_addr_npi: npi,
			destination_addr: dest,
			short_message: message  },
			function(pdu) {

			// log reply - submit_sm_resp
			if (config.showPDUs)wlog.log('debug', "RX submit_sm_resp ",pdu);

			if (pdu.command_status == 0) 
			{
				// Message successfully sent 
				wlog.info("PDU sent ok. Reply gives msg id ="+pdu.message_id);
				msgRef= pdu.message_id;
				
				// testing - send an instant query_sm 
				if ( 0 )
				{
					wlog.info("Send query sm ");
					session.query_sm({
						source_addr: config.smpp_number,
						message_id: pdu.message_id
						}, function(pdu2) {
							wlog.info( "RX query reply ",pdu2);
						});
				}
			}
		});
		
	return msgRef;
}

/* ************************************************************************************* */
// DB raw message save, in and out
/* ************************************************************************************* */
function SavePDU ( pdu , state )
{
	// pause the session so we can get the unique id in 2 db hits
	// without a race condition
	session.pause();
	var sSql="";
	var msgID="";
	if ( dbconn != null )
	{
		// get the highest msgIdx for this prefix
		sSql= "SELECT MAX(msgIdx) AS maxIdx FROM msg WHERE msgGW='" + config.Prefix + "';";
		wlog.debug("DB " + sSql );
		dbconn.query(sSql, 
			function(err, rows, fields)
			{
				if (err) throw err;

				wlog.info('Max ID is: ', rows[0].maxIdx);
				if ( rows[0].maxIdx != null)
					config.msgIdx =rows[0].maxIdx +1;
				else
					config.msgIdx ++;
				// now this is async.. so we need to pass it back to caller
				msgID=SavePDU_IdxSet ( pdu , state );
				session.resume();
				eventEmitter.emit('pdusaved', pdu,msgID );

			}
		);
	}
	else
	{
		config.msgIdx ++;
		msgID=SavePDU_IdxSet ( pdu , state );
		session.resume();
		eventEmitter.emit('pdusaved', pdu,msgID );
	}
}


function GetTS ( )
{
	config.Now = new Date();
	var TS = config.Now.toISOString(); // something like '2011-01-26T13:51:50.417Z'
	TS = TS.replace("T"," ");
	TS = TS.substring(0, TS.length - 5);
	return TS;
}

function SavePDU_IdxSet ( pdu , state )
{
	var sSql="";
	// msgID used in received response
	var msgID = config.Prefix + "_" +config.msgIdx;
	var msgSrc =  pdu.source_addr;
	var msgDst =  pdu.destination_addr;
	var msgMsg =  pdu.short_message.message;
	var msgTS = GetTS();
	
	if ( msgMsg == null )
	{
		msgMsg =  pdu.short_message.Buffer;
	}
	// store the message as received
	if ( dbconn != null )
	{
		// security of input !
		sSql = "INSERT INTO msg (msgID,msgTS,msgSrc,msgDst,msgState,msgGW,msgMsg) VALUES ("+
			dbconn.escape(  msgID  ) +
			"," +dbconn.escape( msgTS ) +
			"," +dbconn.escape( msgSrc ) +
			"," +dbconn.escape( msgDst ) +
			"," +dbconn.escape( state  ) +
			"," +dbconn.escape( config.Prefix ) +
			"," +dbconn.escape( msgMsg )+ 
			");";
		wlog.debug("DB " + sSql );
		dbconn.query( sSql, 
			{ title: 'test' },
			function(err, result)
			{
				if (err) throw err;

				wlog.info('Msg saved to database ' + result.insertId );
			}
		);
	}
	else
	{
		wlog.log("error",'Msg NOT saved to database, db not ready ');
	}
	
	// msgID used in received response
	return msgID;
}
		
function SaveHTTPReply( hType, hMsgID, hMsg )
{
	var sSql = "";
	var hTS = GetTS();
	
	// store the message as received
	if ( dbconn != null )
	{
		var sMsg = hMsg;
		if ( sMsg.length> 255) sMsg= hMsg.substr(0,255);// todo save in longer / multiple records..
		// security of input !
		sSql = "INSERT INTO http ( hType,hMsgID,hTS,hMsg) VALUES ("+
			dbconn.escape( hType )+
			"," +dbconn.escape( hMsgID ) +
			"," +dbconn.escape( hTS ) +
			"," +dbconn.escape( sMsg )+ 
			");";
		wlog.debug("DB " + hType + "=" + sSql );
		dbconn.query( sSql, 
			{ title: 'test' },
			function(err, result)
			{
				if (err) throw err;

				wlog.info('HTTP reply saved to database ' + result.insertId );
			}
		);
	}
	else
	{
		wlog.log("error",'HTTP reply NOT saved to database, db not ready ');
	}
}

function ProcessSSSAMSReply( hSrc, hMsg )
{
	// OK\n n{<reply>\n} DONE\name
	hMsg = hMsg.replace('\r','');
	var lines = hMsg.split('\n');
	
	if ( lines.length == 0)
	{
		wlog.log("error", "Error invalid SSSAMS http reply");
		return;
	}
	
	if ( lines[0] != "OK" )
	{
		wlog.log("error", "Error invalid SSSAMS http reply :"+ lines[0] );
		return;
	}
	
	for (var i = 1; i < lines.length; i++)
	{
		if ( lines[i].indexOf("ERR") == 0)
		{
			// error return, error from server not error with message
			wlog.log("error","SERVER ERROR RETURN "+ lines[i] );
			// to do email/ alert this more widely
		}
		else if ( lines[i].indexOf("DONE") == 0)
		{
			//all done
		}
		else if (  lines[i].indexOf('\t') > 0)
		{
			//MSG +211955482116\tVGW\tWelcome BOSCO YOSEA SIMBA this is now your default phone.
			wlog.debug("Process SSSAMS reply line "+ lines[i] );
			// split on tab
			var fields = lines[i].split('\t');
			if ( fields.length > 2)
			{
				// HT April 15, correct field fmt, message in field 2 not 1
				var msgS = fields[0];
				msgS = msgS.substr(4, msgS.length-4);
				wlog.info("Send SSSAMS reply msg to:"+ msgS + " Msg:"+ fields[2] );
				
				SendSMS( msgS,fields[2] );
			}
			else
			{
				wlog.info("Unable to extract reply sms from http reply:"+ lines[i] );
				
			}
		}
		else if (lines[i].length >0 )
		{
			wlog.log("error","SERVER ERROR IGNORE  LINE ["+ lines[i] +"]");
		}
	}
}

function DoShutdown ()		
{
	// not sure we'll ever get to do a proper tidy up but just in case..
	if ( session != null )
	{
		wlog.silly("SMSGW Shutdown: smpp session");
		session.close();
		session=null;
	}

	if (httpsrv != null)
	{
		wlog.silly("SMSGW Shutdown: http server");
		httpsrv.end();
		httpsrv = null;
	}
	
	if ( dbconn != null )
	{
		wlog.silly("SMSGW Shutdown: database connection");
		dbconn.end();
		dbconn = null;
	}

}

// HT April 15 add reset link call
function ResetCommLink ()
{
	if ( config.connect_reset_script.length > 1 )
	{
		wlog.log('info', 'call reset script: ' + config.connect_reset_script );
		
		var resetSc = spawn(config.connect_reset_script, ['']);
		resetSc.stdout.on('data', function (data) {
			wlog.log('warn', 'reset script: ' + data);
		});

		resetSc.stderr.on('data', function (data) {
			wlog.log('warn', 'reset script: ' + data);
		});

		resetSc.on('exit', function (code) {
		  wlog.log('warn', 'reset script exited with code ' + code);
		});
	}
	
}