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
'use strict';

/* Email module  */
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');
var config = require('./config');
var wlog;
var trans;


function _sendEmail ( subject, body, dest )
{
	var i;
	for( i=0; i< dest.length; i++)
	{
		wlog.info("Send email to " + dest[i] + " subject " + subject);
		if ( trans == undefined)
			wlog.error("EMAIL Error , Email object is undefined");
		else
		{
			trans.sendMail({
				from: config.email.from,
				to: dest[i],
				subject: subject,
				text: body
				}, function(error, info)
				{
					if(error){
						wlog.error( "EMAIL ERROR on send, details:",error);
					} else {
						wlog.info("EMAIL Message sent: " + info.response);
						//wlog.debug("EMAIL completion details ", info.response);
					}
				});
		}
	}
	
}

module.exports.sendEmail = function ( subject, body, dest )
{
	var TS = new Date().toISOString(); // something like '2011-01-26T13:51:50.417Z'
	TS = TS.replace("T"," ");
	TS = TS.substring(0, TS.length - 5);

	var footer = "\n" + config.email.footer + 
		"\nEmail Sent: "+ TS + 
		",Server Name: " + config.Name;
	_sendEmail(subject,body + footer ,dest);
}
module.exports.StartEmail = function( wlogger )
{
	wlog = wlogger;
	wlog.log('silly',"SMSGW Email loading");  
	config.email.auth.pass = config.email.auth.pass.substr(1);
	trans=nodemailer.createTransport( config.email );
	
	
	trans.on('log', function(msg)
		{
			wlog.info("EMAIL Transport " , msg );
		});
	trans.on('error', function(msg)
		{
			wlog.error("EMAIL Transport Error" , msg );
		});
	
	//wlog.log('silly',"SMSGW Email " + trans.name +" "+ trans.version);  
	
	//wlog.log('silly',"SMSGW Email send test");  
	//_sendEmail( "Test from SMS GW","This is a test from the SMS gateway, which is nice", ["howard\@tytherleigh.com"] );
	//wlog.log('silly',"SMSGW Email done");  
}
	