/* 

  Tati 
  A Javascript Debugger without Using the Built-in Runtime Inspector

  Copyright (C) 2022-2023 Arash Kazemi <contact.arash.kazemi@gmail.com>
  
  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

	* Redistributions of source code must retain the above copyright
	  notice, this list of conditions and the following disclaimer.
	* Redistributions in binary form must reproduce the above copyright
	  notice, this list of conditions and the following disclaimer in the
	  documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/


'use strict';


const esprima = require("esprima");
const escodegen = require("escodegen");

class Tati 
{

	last_column = -1;
	last_row = -1;

	error = null;

	#ui_refresh_steps = 50000;
	#ui_refresh_time = 0; // ms

	#default_root = {};

	#run_func = null;
	#debug_func = null;

	#esp = null;
	#debug_resolve = null;
	#worker = null;

	#breakpoints = {};
	#context = {};
	#masked = ["globalThis", "self"]; // the class name will also be added in constructor

	#run_to_breakpoint = false;
	#step_loop_args = null;

	#get_worker_context_resolve = null;
	#set_worker_context_resolve = null;
	__get_worker_context_on_next_step__ = true;

	#ui_refresh_counter = 0;
	#prepare_index = 0;


	/**
	* Creates an instance of Tati.
	* There can be multiple instances and each can be controlled separately.
	* 
	* @constructor
	* 
	* @param {function} step_callback - The callback handler for stepping. It is 
	*        called before the runner runs a breakpoint or steps to the next line. 
	*        The row and column of the next step is given as the first and second 
	*        arguments. If the watch flag is set, a third argument of watches values
	*        is also passed to the callback. The watched values is a dictionary, 
	*        containing values of the local variables before running that step. If a 
	*        variable is shadowed by another, the most recent value is shown.
	* 
	* If the step callback returns true, the execution will be paused until one of 
	* the functions `step()` or `continue()` is called. If it returns false the 
	* execution continues to the step or breakpoint.
	* 
	* @param {function} stop_callback - Is called when the running of the code is 
	*        finished.
	* 
	* @param {function} error_callback - Is called when there is an error in parse 
	* 		 or run time. The first and second arguments are the line and column, 
	*        third argument would be the type of error (parse or runtime), and the 
	*        forth would be the error description. 
	* 
	* In case of parser errors, if `error_callback` argument is given to the 
	* constructor, Tati will call it.
	*
	* In case of runtime errors, if `error_callback` argument is given to the 
	* constructor, Tati will call it. But it will not cancel the event or stop 
	* its propagation so it doesn't interfere with any other code handling mechanism. 

	* @param {boolean} use_worker - If set, the debugger will run in a web worker, 
	* much safer but communication with it will be limited so the context should be 
	* plain object and the script won't be able to interact with any other object 
	* (like DOM) directly.
	*/


	constructor(  step_callback=null, 
							  stop_callback=null, 
							  error_callback=null, 
							  use_worker=false,
							  default_root ) 
	{

		var perr = Tati.__error_proxy__.bind(this);

		if(default_root!==undefined) this.#default_root = default_root;

		if(use_worker) {

			var build_worker = function(foo) {
				// Based on an answer on stackoverflow.com https://stackoverflow.com/a/16799132 by user @dan-man

				var str = foo.toString().match(/^\s*function\s*\(\s*\)\s*\{(([\s\S](?!\}$))*[\s\S])/)[1];

				if( typeof(Worker_threads)!=="undefined" ) {
					return new Worker_threads.Worker(window.URL.createObjectURL( new Blob([str],{type:'text/javascript'})) );
				}

				return new Worker(window.URL.createObjectURL( new Blob([str],{type:'text/javascript'})) );
			}

			this.#worker = build_worker( function() {

				self.__tati_space__ = {};
				self.__tati_space__.resolver = null;

				self.__tati_space__.step_callback = async function(r,c,vals) {
					if(self.__tati_space__.tati.__get_worker_context_on_next_step__) {
						self.postMessage( 
											{
												ev:'step',r:r,c:c,vs:{...vals}, 
												ctx:self.__tati_space__.Tati.__recursive_clone__
																(self.__tati_space__.tati.__get_w_context__())
											} 
										);
					}
					else {
						self.postMessage( {ev:'step',r:r,c:c,vs:{...vals}} );
					}

					const msg_promise = new Promise((resolve) => self.__tati_space__.resolver = resolve);

					return await msg_promise;
				}

				self.__tati_space__.stop_callback = function() {
					if(self.__tati_space__.tati.__get_worker_context_on_next_step__) {
						self.postMessage( 
											{
												ev:'stop',
												ctx:self.__tati_space__.Tati.__recursive_clone__
																(self.__tati_space__.tati.__get_w_context__())
											} 
										);
					}
					else {
						self.postMessage( {ev:'stop'} );
					}
				}

				self.__tati_space__.error_callback = function(r,c,t,d) {
					self.postMessage({ev:'err',r:r,c:c,t:t,d:d});
				}


				self.__tati_space__.tati = null;

				self.onmessage = async function(e) {

					if(self.__tati_space__.tati===null) {
						eval(e.data+";self.__tati_space__.Tati = Tati;");

						var Tati = self.__tati_space__.Tati; 

						self.__tati_space__.tati = new Tati(self.__tati_space__.step_callback, self.__tati_space__.stop_callback, self.__tati_space__.error_callback);
						self.__tati_space__.onerror = self.__tati_space__.Tati.__error_proxy__.bind(self.__tati_space__.tati);
					}
					else {
						var Tati = self.__tati_space__.Tati; 

						if(e.data.func==="set-funcs") {
							if(e.data.args===null) {
								self.__tati_space__.tati.__set_worker_funcs__(null,null);
							}
							else {
								self.__tati_space__.tati.__set_worker_funcs__(
													eval("("+e.data.args[0]+")"),
													eval("("+e.data.args[1]+")")
												);
							}
						}
						else if(e.data.func==="step-response") {
							self.__tati_space__.resolver(e.data.args[0]);
						}
						else if(e.data.func==="getWorkerContext") {
							self.postMessage( { ev:'context', 'ctx': await self.__tati_space__.tati.__get_w_context__() } );
						}
						else {
							self.__tati_space__.tati[e.data.func](...e.data.args);
							if(e.data.func==="set_worker_context") {
								self.postMessage( { ev:'set-context' } );
							}
						}
					}
				};

			});

			this.#worker.onmessage = (e) => {
				if(e.data.ev==="step") {
					if(e.data.ctx!==undefined) {
						this.#context = e.data.ctx;
					}
					this.#worker.postMessage( 
							{ 	
								func:"step-response", 
								args: [this.step_callback(e.data.r, e.data.c, e.data.vs)] 
							} 
						);
				}
				else if(e.data.ev==="context") {
					this.#get_worker_context_resolve(e.data.ctx);
				} 
				else if(e.data.ev==="set-context") {
					this.#set_worker_context_resolve();
				} 
				else if(e.data.ev==="stop") {
					if(e.data.ctx!==undefined) {
						this.#context = e.data.ctx;
					}
					if(this.stop_callback!==null)
						this.stop_callback();
				} 
				else if(e.data.ev==="err") {
					this.error_callback(e.data.r, e.data.c, e.data.t, e.data.d);
				}

			}

			this.#worker.onerror = perr;
			this.#worker.postMessage(Tati.toString());
		}

		if(this.#__is_browser__()) {
			window.addEventListener("unhandledrejection", perr);
		}
		else if(Tati.__is_worker__()) {
		}
		else {
			process.on('unhandledRejection', perr);
		}


		this.step_callback = step_callback;
		this.stop_callback = stop_callback;
		this.error_callback = error_callback;

		this.#masked.push(this.constructor.name);

	}


	/**
	* Parses the given code, and prepares it for the flow with control,
	* throws exception if there is a syntax problem in code.
	* 
	* @param {string} code - The javascript code to compile/run.
	* 
	* @param {boolean} watch_locals - If set, the callback will receive a
	* snapshot of the local variables in an object too.
	*
	* @param {boolean} step_loop_args - If set, it will also step into 
	*        loop test and update expressions, like `i<n` and `i++` in the loop:
	* 
	*            for( let i=0; i<n; i++ ) {...}
	* 
	*/

	prepare( code, watch_locals=true, step_loop_args=true ) 
	{
		this.#prepare_index++;

		this.#step_loop_args = step_loop_args;

		var ws = watch_locals ? [[]] : null;

		try {
			this.#esp = esprima.parse( code, {loc:true} );
		}
		catch(e) {

			this.#run_func = null;
			this.#debug_func = null;

			if(this.#worker!==null) {
				this.#worker.postMessage({"func":"set-funcs", "args":null});						
			}

			if(this.error_callback!=null) {
				this.error_callback(e.lineNumber, e.column, "parse", e.description);
			}
			this.error = e;

			return;
		}


		let ctx = [ "__tati_template_watch_args__",
					"__tati_template_no_watch_args__",
					...Object.keys(this.#context), 
					"__tati_space__", 
					...this.#masked ].join(',');

		this.#run_func = eval(`(async function(${ctx}) { ${escodegen.generate(this.#esp)} })`);

		this.#asyncize(this.#esp);
		this.#tatize(this.#esp, ws);

		this.#debug_func = eval(`(async function(${ctx}) { ${escodegen.generate(this.#esp)} })`);

		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"set-funcs", "args":[this.#run_func.toString(), this.#debug_func.toString()]});						
		}

		this.#run_func = this.#run_func.bind(this.#default_root);
		this.#debug_func = this.#debug_func.bind(this.#default_root);

		this.error = null;
	};


	/**
	* Runs the prepared code as it is, **without** the debug codes. 
	* The only difference is that it is processed anyway, so the flow and 
	* the environment of the two debug/release procedures would be the same.                
	*/

	run() 
	{

		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"run", "args":[...arguments]});
			return;
		}

		if(this.#run_func==null) return;

		let pr = this.#run_func(
							this.#__template_watch_args__.bind(this,this.#prepare_index),
							this.#__template_no_watch_args__.bind(this,this.#prepare_index),
							...Object.values(this.#context))

		pr.then( (function() {

			if(this.stop_callback!=null) {
				this.stop_callback();
			}

			this.last_row=-1;
			this.last_column=-1;

		}).bind(this) );

		pr.catch( (function(e) {
			if(this.error_callback!=null) {
				Tati.__error_proxy__.bind(this)(e);
			}
			this.error = e;

		}).bind(this) );
	}


	/**
	* Runs the prepared code **with** the debug codes. 
	* You can step line by line or run until reaching a breakpoint. It will 
	* call the `step_callback` that was given to constructor.
	* 
	* @param {boolean} run_to_breakpoint - If true it will continue running 
	* until reaching a breakpoint. If false, it will step line by line.
	*/

	debug(run_to_breakpoint=false) 
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"debug", "args":[...arguments]});
			return;
		}

		if(this.#debug_func==null) return;

		this.#run_to_breakpoint = run_to_breakpoint;

		let pr = this.#debug_func(
							this.#__template_watch_args__.bind(this,this.#prepare_index),
							this.#__template_no_watch_args__.bind(this,this.#prepare_index),
							...Object.values(this.#context));

		pr.then( (function() {

			if(this.stop_callback!=null) {
				this.stop_callback();
			}

			this.last_row=-1;
			this.last_column=-1;

		}).bind(this) );

		pr.catch( (function(e) {
			if(this.error_callback!=null) {
				Tati.__error_proxy__.bind(this)(e);
			}
			this.error = e;

		}).bind(this) );

	}


	/**
	* Steps to the next line/expression.
	* It will call the `step_callback` that was given to constructor.
	* 
	* @param {boolean} get_worker_context_on_callback When using workers, 
	* Tati updates the context values before calling the `step_callback`, 
	* unless the `get_worker_context_on_callback` parameter is set to `false`. 
	* It may be needed when the context variables are big and transmitting them 
	* between the user instance and the worker are intensive. In such cases, 
	* if the user needs to check the new context values, they should call 
	* {@link Tati#getWorkerContext} before getting the context.
	*/

	step(get_worker_context_on_callback=true) 
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"step", "args":[...arguments]});
			return;
		}

		this.__get_worker_context_on_next_step__ = get_worker_context_on_callback;

		this.#run_to_breakpoint = false;
		if(this.#debug_func!==null && this.#debug_resolve!=null) {
			this.#debug_resolve(true);
		}
	}


	/**
	* Runs to the next breakpoint or end.
	* It will call the `step_callback` that was given to constructor on 
	* reaching a breakpoint.
	* 
	* @param {boolean} get_worker_context_on_callback see {@link Tati#step} 
	*/

	continue(get_worker_context_on_callback=true) 
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"continue", "args":[...arguments]});
			return;
		}

		this.__get_worker_context_on_next_step__ = get_worker_context_on_callback;

		this.#run_to_breakpoint = true;
		if(this.#debug_func!==null && this.#debug_resolve!=null) {
			this.#debug_resolve(true);
		}
	}


	/**
	* Pauses the script. When the script is running an intensive loop or process, 
	* checking for pause command will be done in intervals, which can be configured
	* using {@link Tati@configureUIRefreshRate}. 
	* 
	* When an script with a timeout or interval is being debugged but no breakpoint 
	* is set, pause will be applied on the next callback, Tati will prevent timer
	* callback execution, but it doesn't stop the runtime event loop, so they will
	* expire as defined.
	* 
	* Also note that Tati can only pause inside the given script and cannot 
	* enter the called functions that are defined elsewhere, i.e. native functions 
	* or external libraries.
	* 
	* @param {boolean} get_worker_context_on_callback see {@link Tati#step} 
	*/

	pause(get_worker_context_on_callback=true) 
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"pause", "args":[...arguments]});
			return;
		}

		this.__get_worker_context_on_next_step__ = get_worker_context_on_callback;
		this.#run_to_breakpoint = false;
	}


	/**
	* Configures the UI refresh checking. This is to make sure UI is responsive
	* and specially the process is pausable, which cannot be ensured on every
	* cycle because of performance considerations. As a result, UI refresh config
	* is not for a precise flow control, for a precise control use the 
	* `step_callback` return value. For more info see {@link Tati#constructor}.
	* 
	* @param {integer} ui_refresh_steps How many steps to take before refreshing
	* the UI.
	* 
	* @param {integer} ui_refresh_time The time it will wait before continuing 
	* the process.
	*/

	configureUIRefreshRate(ui_refresh_steps, ui_refresh_time) 
	{
		this.#ui_refresh_steps = ui_refresh_steps;
		this.#ui_refresh_time = ui_refresh_time; // ms
	}


	/**
	* Sets a breakpoint on the given line.
	*/

	setBreakpoint(line) 
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"setBreakpoint", "args":[...arguments]});
			return;
		}

		this.#breakpoints[''+line] = true;
	}

	/**
	* Sets all breakpoints. Breakpoints should be in the form of
	* { 5: true, 10: true } where the keys are the line numbers
	* and the breakpoint is only set if the value is exactly true.
	*/

	setAllBreakpoints(bps) 
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"setAllBreakpoints", "args":[...arguments]});
			return;
		}

		this.#breakpoints = bps;
	}

	/**
	* Clears the breakpoint on the given line.
	*/

	clearBreakpoint(line) 
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"clearBreakpoint", "args":[...arguments]});
			return;
		}

		delete this.#breakpoints[''+line];
	}

	/**
	* Clears all the breakpoints.
	*/

	clearAllBreakpoints() 
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"clearAllBreakpoints", "args":[...arguments]});
			return;
		}

		this.#breakpoints = {};
	}

	/**
	* Sets context variables. The members of the context will be set
	* as given in this object. The masked argument can be used to define
	* the variables and objects to be masked. Note that the masked are
	* given in a list of strings.
	* 
	*     k.setContext({foo:123, bar:"hello"}, [document, window]);
	* 
	* The masked list is not necessary, and if not set, the masked list 
	* contains three predefined elements: `globalThis`, self and the class 
	* name of Tati, which is normally Tati itself.
	* 
	* This function should be called before calling `prepare` if the keys 
	* of the context or the members of the masked list are changed. But it
	* won't be necessary if only the values of context variables are 
	* changed later. 
	* 
	* Note that if `use_worker` is set to `true` in the constructor, the 
	* worker context objects are clones and are not directly accessible. 
	* So directly modifying the value of context variables won't work and 
	* you should use `setContext` or `setContextVariable` methods. 
	* Also note that the context object must be a plain object when using 
	* workers. Tati will automatically convert context variables to 
	* plain objects when using workers, which means the functions will be 
	* converted to `undefined`.
	* 
	* This function is asynchronous, so you may want to use await to make
	* sure the context is set accordingly.
	*/

	async setContext(context, masked) 
	{

		if(masked!==undefined) {
			this.#masked = [...masked];
		}

		if(context!==undefined) {
			this.#context = {...context};
		}

		if(this.#worker!==null) {
			try {
				this.#worker.postMessage({"func":"setContext", "args":Tati.__recursive_clone__([...arguments])});
				const msg_promise = new Promise((resolve) => this.#set_worker_context_resolve = resolve);
				await msg_promise;
			}
			catch(e) {
				throw "Error in cloning context object to pass to the worker. When using workers, context must be a plain object."
			}
		}

	}


	/**
	* Sets or defines context variables. Like `setContext`, the prepare 
	* function should be called after adding new context properties.
	* And if `use_worker` is set `true`, the clones of the set values will
	* be used in the worker.
	* 
	* This function is asynchronous, so you may want to use await to make
	* sure the context is set accordingly.
	*/

	async setContextVariable(varname, value) 
	{

		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"setContextVariable", "args":Tati.__recursive_clone__([...arguments])});
			const msg_promise = new Promise((resolve) => this.#set_worker_context_resolve = resolve);
			await msg_promise;
		}

		this.#context[varname] = value;
	}

	/**
	* Returns the value of a context variable. This can be used to access
	* the results of the script being debugged. Of course, the only types
	* that can be modified from inside the scripts are arrays and objects,
	* i.e. the variables that are passed by reference and not by value.
	* This will still be true when using workers, the only difference is
	* that a cloning will be applied and the results will only contain
	* plain objects. See also {@link Tati#getWorkerContext} 
	*/

	getContextValue(varname) 
	{
		return this.#context[varname];
	}

	/**
	* Returns the list of context variables.
	*/

	getContextList() 
	{
		return Object.keys(this.#context);
	}




	/**
	* This is used to update the context copy outside the worker. Note
	* that this is not usually needed as Tati updates the context values
	* before calling the `step_callback`, unless the `get_worker_context_on_callback`
	* parameter is set to `false`. It may be needed when the context variables 
	* are big and transmitting them between the user instance and the worker
	* are intensive. In such cases, if the user needs to check the new context
	* values, they should call this before getting the context.
	* 
	* Note that this function is asynchronous, so you may need to use it 
	* with an await directive.
	*/

	async getWorkerContext()
	{
		if(this.#worker!==null && !this.__get_worker_context_on_next_step__) {
			this.#worker.postMessage({"func":"getWorkerContext", "args":[...arguments]});

			const msg_promise = new Promise((resolve) => this.#get_worker_context_resolve = resolve);
			this.#context = await msg_promise;
		}
	}




	// For internal use


	__set_worker_funcs__(run_func, debug_func) 
	{
		if(Tati.__is_worker__()) {
			if(run_func!==null) run_func = run_func.bind(this.#default_root);
			if(debug_func!==null) debug_func = debug_func.bind(this.#default_root);

			this.#run_func = run_func;
			this.#debug_func = debug_func;
		}
	}

	__get_w_context__() 
	{
		if(Tati.__is_worker__()) {
			return this.#context;
		}
	}

	#__is_browser__ = new Function("try {return this===window;}catch(e){ return false;}").bind(undefined);

	#wrap(a, ws) 
	{
		this.#tatize( a, ws );

		if(a.type!="BlockStatement" && a.type!="CatchClause") {
			var el = {
				"type": "BlockStatement",
				"body": [ this.#template_block(a, ws), a ]
			};

			return el;
		}

		return a;
	};

	#tatize(a,ws) 
	{
		if( a==null ) return null;
		if( typeof(a.type)=="undefined" ) return;

		if(ws!=null && a.type=="BlockStatement") ws=[ws];

		if( a.type=="Program" || 
			a.type=="BlockStatement" ) 
		{
			for(var i=0; i<a.body.length; i++) {

				var abi = a.body[i];

				if( abi.type!="BlockStatement" &&
					abi.type!="FunctionDeclaration" &&
					abi.type!="DoWhileStatement" ) 
				{

					var el =  this.#template_block(abi, ws);
					if(typeof(el)==typeof(undefined)) continue;

					a.body.splice(i,0,el);
					i++;
				}

				this.#tatize( abi, ws );
			}
		}
		else if(a.type=="ForStatement") {
			if(this.#step_loop_args) {

				this.#tatize(a.init, ws);
				a.test = this.#template_inline(a.test, ws);
				a.update = this.#template_inline(a.update, ws);
			}

			a.body = this.#wrap(a.body, ws);
		}
		else if(a.type=="DoWhileStatement" || 
			a.type=="WhileStatement" )
		{
			if(this.#step_loop_args) {
				a.test = this.#template_inline(a.test, ws);
			}

			a.body = this.#wrap(a.body, ws);
		}
		else if(a.type=="FunctionDeclaration" || 
			a.type=="FunctionExpression" ||
			a.type=="ForInStatement" ||
			a.type=="ForOfStatement" ||
			a.type=="CatchClause" ||
			a.type=="WithStatement") 
		{
			if( a.type=="FunctionDeclaration" || 
				a.type=="FunctionExpression") {

				for(var j=0; j<a.params.length; j++) {
					if(ws!=null)
						ws.push(a.params[j].name);
				}       
			}
			a.body = this.#wrap(a.body, ws);
		}
		else if(a.type=="IfStatement") {
			if(a.alternate!=null) a.alternate = this.#wrap(a.alternate, ws);
			if(a.consequent!=null) a.consequent = this.#wrap(a.consequent, ws);
		}
		else if(a.type=="TryStatement") {
			if(a.block!=null) a.block = this.#wrap(a.block, ws);
			if(a.handler!=null) a.handler = this.#wrap(a.handler, ws);
			if(a.finalizer!=null) a.finalizer = this.#wrap(a.finalizer, ws);
		}
		else if(a.type=="SwitchStatement") {

			for(var i=0; i<a.cases.length; i++) {

				var c = a.cases[i].consequent;

				for(var j=0; j<c.length; j++) {

					if( c[j].type!="BlockStatement" &&
						c[j].type!="FunctionDeclaration" &&
						c[j].type!="FunctionExpression" &&
						c[j].type!="DoWhileStatement" ) 
					{

						var el = this.#template_block(c[j], ws);

						c.splice(j,0,el);
						j++;
					}

					this.#tatize( c[j], ws );
				}
			}
		}
		else if(a.type=="VariableDeclaration") {
			for(var j=0; j<a.declarations.length; j++) {
				this.#tatize( a.declarations[j], ws );
			}
		}
		else {
			if(a.type=="VariableDeclarator") {
				if(ws!=null)
					ws.push(a.id.name);
			}

			for(let i in a) {
				if( Array.isArray(a[i]) ) {
					for(let j in a[i]) {
						this.#tatize( a[i][j], ws );
					}
				}
				else {
					this.#tatize( a[i], ws );
				}
			}
		}

		if(ws!=null && a.type=="BlockStatement") ws=ws[0];
	}

	#asyncize(ast) 
	{

		if(typeof(ast)=="object" ) {
			for(let el in ast) {
				this.#asyncize(ast[el]);

				if(ast[el]!=null && typeof(ast[el].type)!="undefined") {

					if(ast[el].type=="CallExpression") {
						ast[el] = {
							"type": "AwaitExpression",
							"argument": ast[el]
						}
					}
					else if(ast[el].type=="FunctionDeclaration" || ast[el].type=="FunctionExpression") {
						ast[el].async=true;
					}
				}
			}
		}
	}

	#template_generate_watch_args(ws)
	{
		if(ws.length==0) return [];

		var wss=this.#template_generate_watch_args(ws[0]);

		for(let i=1; i<ws.length; i++) {
			wss.push({
				"type": "Literal",
				"value": ws[i],
				"raw": "\""+ws[i]+"\""
			});

			wss.push({
				"type": "ConditionalExpression",
				"test": {
					"type": "BinaryExpression",
					"operator": "==",
					"left": {
						"type": "UnaryExpression",
						"operator": "typeof",
						"argument": {
							"type": "Identifier",
							"name": ws[i]
						},
						"prefix": true
					},
					"right": {
						"type": "Literal",
						"value": "undefined",
						"raw": "'undefined'"
					}
				},
				"consequent": {
					"type": "Identifier",
					"name": "undefined"
				},
				"alternate": {
					"type": "Identifier",
					"name": ws[i]
				}
			});
		}

		return wss;
	}

	#template_block(el,ws)
	{

		let res = {
			"type": "ExpressionStatement",
			"expression": {
				"type": "AwaitExpression",
				"argument": {
					"type": "CallExpression",
					"callee": {
						"type": "Identifier",
						"name": "__tati_template_no_watch_args__"
					},
					"arguments": [
					{
						"type": "Literal",
						"value": el.loc.start.line,
						"raw": "" + el.loc.start.line
					}, 
					{
						"type": "Literal",
						"value": el.loc.start.column,
						"raw": "" + el.loc.start.column
					}
					],
					"optional": false
				}
			}
		};

		if(ws!=null) {
			let wss = this.#template_generate_watch_args(ws);
			res.expression.argument.callee.name="__tati_template_watch_args__";
			res.expression.argument.arguments.push(...wss);
		}

		return res;
	};

	#template_inline(el,ws)
	{

		let res = {
			"type": "LogicalExpression",
			"operator": "&&",
			"left": {
				"type": "AwaitExpression",
				"argument": {
					"type": "CallExpression",
					"callee": {
						"type": "Identifier",
						"name": "__tati_template_no_watch_args__"
					},
					"arguments": [
					{
						"type": "Literal",
						"value": el.loc.start.line,
						"raw": "" + el.loc.start.line
					}, 
					{
						"type": "Literal",
						"value": el.loc.start.column,
						"raw": "" + el.loc.start.column
					}
					],
					"optional": false
				}
			},
			"right": el
		};

		if(ws!=null) {
			let wss = this.#template_generate_watch_args(ws);
			res.left.argument.callee.name="__tati_template_watch_args__";
			res.left.argument.arguments.push(...wss);
		}

		return res;
	};


	async #__template_watch_args__(pid, r,c) 
	{
		if(pid!==this.#prepare_index) return new Promise( function(res,rej) {} );

		const self = this;

		c++;

		this.last_column = c;
		this.last_row = r;

		if(this.#ui_refresh_counter>=this.#ui_refresh_steps) {
			this.#ui_refresh_counter=0;
			await new Promise(r => setTimeout(r, this.#ui_refresh_time));
		}
		else this.#ui_refresh_counter++;

		if( this.#run_to_breakpoint ) {

			if(this.#breakpoints[r]) {

				let vals={};

				for(let i=4;i<arguments.length;i+=2) {
					if(arguments[i+1]==undefined) {
						vals[arguments[i]]=undefined;
					}
					else {
						vals[arguments[i]]=arguments[i+1];
					}
				}

				if( this.step_callback(r,c,vals) ) {
					return new Promise(
						function(res,rej) {
							self.#debug_resolve=res;
						}
						);
				}
			}

		}
		else {
			let vals={};

					for(let i=4;i<arguments.length;i+=2) {
						if(arguments[i+1]==undefined) {
							vals[arguments[i]]=undefined;
						}
						else {
							vals[arguments[i]]=arguments[i+1];
						}
					}

			if( this.step_callback(r,c,vals) ) {
				return new Promise(
					function(res,rej) {
						self.#debug_resolve=res;
					}
					);
			}
		}
		return true;
	}

	async #__template_no_watch_args__(pid, r,c) 
	{
		if(pid!==this.#prepare_index) return new Promise( function(res,rej) {} );

		const self = this;

		c++;

		this.last_column = c;
		this.last_row = r;

		if(this.#ui_refresh_counter>=this.#ui_refresh_steps) {
			this.#ui_refresh_counter=0;
			await new Promise(r => setTimeout(r, this.#ui_refresh_time));
		}
		else this.#ui_refresh_counter++;

		if( this.#run_to_breakpoint ) {

			if(this.#breakpoints[r]) {
				if( this.step_callback(r,c) ) {
					return new Promise(
							function(res,rej) {
								self.#debug_resolve=res;
							}
						);
				}
			}

		}
		else {
			if( this.step_callback(r,c) ) {
				return new Promise(
						function(res,rej) {
							self.#debug_resolve=res;
						}
					);
			}
		}
		return true;
	}

	static __error_proxy__(err)
	{
		if(this.error_callback!=null) {
			if(err.reason!==undefined) {
				this.error_callback(this.last_row, this.last_column, "runtime", err.reason.message);
			}
			else if(err.message!==undefined) {
				this.error_callback(this.last_row, this.last_column, "runtime", err.message);
			}
			else {
				this.error_callback(this.last_row, this.last_column, "runtime", ""+err);
			}
		}
		this.error = err;

		this.last_row=-1;
		this.last_column=-1;
	}

	static __is_worker__()
	{
		if( typeof(Worker_threads)!=="undefined" ) {
			return !Worker_threads.isMainThread;
		}
		return typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
	}

	static __recursive_clone__(o)
	{
	  let oc;
	  
	  if(o instanceof Array) oc = [];
	  else oc = {};

	  for(let i in o) {
	    let v=o[i];
	    if(typeof v=='number' || typeof v=='string' || v===null || v===undefined) {
	      oc[i]=v;
	    }
	    else if(typeof v=='function') {
	      oc[i] = undefined;
	    }
	    else oc[i] = Tati.__recursive_clone__(v);
	  }
	  return oc;
	}
}

module.exports = Tati;
