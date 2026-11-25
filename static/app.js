"use strict";
const $=id=>document.getElementById(id);
const E=(tag,txt,cls)=>{const n=document.createElement(tag);if(txt!=null)n.textContent=txt;if(cls)n.className=cls;return n};
const C=(parent,...nodes)=>{for(const n of nodes.flat())if(n)parent.append(n);return parent};
const API_BASE=location.hostname==="redaction.suaveforge.com"?"https://api-redaction.suaveforge.com:19447":"";
let account=null,csrf="",current="overview",selectedDoc=null,pageIndex=0,selectedFinding=null,drawMode=false,detailData=null,refreshTimer=null,docsFilter={q:"",status:""};
const statuses={queued:"Queued",processing:"Processing",review:"In review",approval:"Awaiting approval",releasing:"Preparing release",releasing_work:"Preparing release",released:"Released",failed:"Processing failed",accepted:"Accepted",rejected:"Rejected",pending:"Unresolved"};
const roles={administrator:"Administrator",reviewer:"Reviewer",approver:"Approver",intake:"Intake"};
const status=s=>E("span",statuses[s]||s,"badge "+s);
const btn=(label,fn,cls="")=>{const n=E("button",label,cls);n.type="button";n.addEventListener("click",fn);return n};
const input=(name,type="text",value="")=>{const n=E("input");n.name=name;n.type=type;if(value)n.value=value;return n};
const labelled=(label,node)=>C(E("label",label),node);
const select=(name,items,value)=>{const n=E("select");n.name=name;for(const x of items){const o=E("option",Array.isArray(x)?x[1]:x);o.value=Array.isArray(x)?x[0]:x;n.append(o)}if(value!=null)n.value=value;return n};
const fmt=t=>t?new Date(t).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):"Not recorded";
const canReview=()=>["administrator","reviewer"].includes(account?.role);
const canApprove=()=>["administrator","approver"].includes(account?.role);
const canIntake=()=>["administrator","reviewer","intake"].includes(account?.role);
const isAdmin=()=>account?.role==="administrator";
async function api(path,method="GET",body){
 const opt={method,headers:{"X-CSRF-Token":csrf},credentials:"include"};
 if(body instanceof FormData)opt.body=body;else if(body!==undefined){opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(body)}
 const r=await fetch(API_BASE+path,opt);let d;try{d=await r.json()}catch{d={error:"The request could not be completed."}}
 if(!r.ok)throw Error(d.error||"Request failed");return d
}
function notify(t){$("toast").textContent=t;$("toast").hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$("toast").hidden=true,4500)}
function action(fn){return async()=>{try{await fn()}catch(e){notify(e.message)}}}
function pageHead(title,subtitle,buttons=[]){return C(E("div",null,"page-head"),C(E("div"),E("h1",title),E("p",subtitle)),C(E("div",null,"toolbar"),buttons))}
function panel(title,...children){return C(E("section",null,"panel"),title?E("h2",title):null,children)}
function table(headers,rows){if(!rows.length)return E("div","No records to display.","empty");const t=E("table"),h=E("thead"),tr=E("tr");for(const v of headers)tr.append(E("th",v));h.append(tr);t.append(h);const body=E("tbody");for(const row of rows){const tr=E("tr");for(const v of row){const td=E("td");td.append(v instanceof Node?v:document.createTextNode(v??""));tr.append(td)}body.append(tr)}t.append(body);return C(E("div",null,"table-wrap"),t)}
function modal(title,body){$("modal-title").textContent=title;$("modal-body").replaceChildren(body);$("modal").showModal()}
function form(fields,buttonLabel,submit){const f=E("form",null,"form-grid");f.append(...fields);const b=E("button",buttonLabel,"primary");b.type="submit";const err=E("p",null,"error");f.append(b,err);f.addEventListener("submit",async e=>{e.preventDefault();b.disabled=true;err.textContent="";try{await submit(new FormData(f));$("modal").close()}catch(x){err.textContent=x.message}finally{b.disabled=false}});return f}
function textPrompt(title,label,run){const t=E("textarea");t.name="reason";t.required=true;t.maxLength=500;modal(title,form([labelled(label,t)],"Confirm",async fd=>{await run(String(fd.get("reason")));}))}
function setAccount(d){account=d.user;csrf=d.csrf;$("login").hidden=true;$("workspace").hidden=false;$("account-name").textContent=account.name;$("account-role").textContent=roles[account.role]||account.role;
 for(const b of document.querySelectorAll("[data-view]")){const v=b.dataset.view;b.hidden=(v==="rules"&&account.role==="intake")||(v==="audit"&&!canApprove())||(["users","integration"].includes(v)&&!isAdmin())}
 navigate("overview");clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(current==="overview"||current==="documents"||(current==="detail"&&["queued","processing","releasing","releasing_work"].includes(detailData?.document.status)))render().catch(()=>{})},5000)}
function signOut(){account=null;csrf="";clearInterval(refreshTimer);$("workspace").hidden=true;$("login").hidden=false;$("login-password").value=""}
$("login-form").addEventListener("submit",async e=>{e.preventDefault();$("login-error").textContent="";const f=new FormData(e.currentTarget);try{setAccount(await api("/api/login","POST",Object.fromEntries(f)))}catch(x){$("login-error").textContent=x.message}});
document.querySelector("[data-action=logout]").addEventListener("click",action(async()=>{await api("/api/logout","POST",{});signOut()}));
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
$("refresh").addEventListener("click",action(render));
function navigate(view){current=view;selectedDoc=null;detailData=null;render().catch(e=>notify(e.message))}
function show(content){$("content").replaceChildren(content)}
async function render(){
 if(!account)return;
 for(const b of document.querySelectorAll("[data-view]"))b.classList.toggle("active",b.dataset.view===(current==="detail"?"documents":current));
 $("breadcrumb").textContent=current==="detail"?"Documents / Review":({overview:"Overview",documents:"Documents",rules:"Redaction rules",audit:"Audit log",users:"Users and access",integration:"Integrations"}[current]||"Workspace");
 const v=current,id=selectedDoc;
 if(v==="overview")await overview(v);else if(v==="documents")await documents(v);else if(v==="detail")await detail(id);else if(v==="rules")await rulesView(v);else if(v==="audit")await auditView(v);else if(v==="users")await usersView(v);else if(v==="integration")integrationView()
}
function uploadModal(){
 const file=input("files","file");file.multiple=true;file.required=true;file.accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.docx,.odt,.rtf,.txt,.eml";
 const ref=input("case_ref");ref.required=true;ref.maxLength=100;
 modal("Add documents",form([labelled("Case reference",ref),labelled("Request type",select("case_type",["FOI","SAR","Legal disclosure","Information governance"])),labelled("Source documents",file),E("p","Up to 20 files per batch. PDF, Word, text, images, scanned pages and email with supported attachments.","muted")],"Upload and analyse",async fd=>{await api("/api/documents","POST",fd);notify("Documents queued for analysis.");navigate("documents")}));
}
async function overview(v){const m=await api("/api/metrics");if(current!==v)return;const q=E("div");q.append(pageHead("Overview","Document workload and release activity",canIntake()?[btn("Add documents",uploadModal,"primary")]:[]));
 const metrics=E("div",null,"metrics");for(const [label,value] of [["Documents",m.total],["In review",(m.statuses.review||0)+(m.statuses.approval||0)],["Pages processed",m.pages],["Released",m.statuses.released||0]])metrics.append(C(E("div",null,"metric"),E("span",label),E("b",String(value))));q.append(metrics);
 function bars(rows){if(!rows.length)return E("div","No activity recorded.","empty");const max=Math.max(1,...rows.map(x=>x[1]));const d=E("div");for(const [l,n] of rows){const f=E("div",null,"barfill");f.style.width=(100*n/max)+"%";d.append(C(E("div",null,"barrow"),E("span",l),C(E("div",null,"bartrack"),f),E("b",String(n))))}return d}
 q.append(C(E("div",null,"split"),panel("Workload by stage",bars(Object.entries(m.statuses).map(([s,n])=>[statuses[s]||s,n]))),panel("Request types",bars(m.cases.map(c=>[c.case_type,c.count])))));
 q.append(panel("Release performance",C(E("div",null,"details-grid"),C(E("div"),E("span","Accepted redactions"),E("b",String(m.accepted))),C(E("div"),E("span","Mean turnaround"),E("b",m.mean_turnaround_seconds==null?"Not yet recorded":Math.round(m.mean_turnaround_seconds/60)+" min")))));
 q.append(btn("Open document queue",()=>navigate("documents")));show(q)}
function openDoc(id){current="detail";selectedDoc=id;pageIndex=0;selectedFinding=null;drawMode=false;render().catch(e=>notify(e.message))}
async function documents(v){const d=await api("/api/documents");if(current!==v)return;const root=E("div");root.append(pageHead("Documents","Intake, review and release",canIntake()?[btn("Add documents",uploadModal,"primary")]:[]));
 const q=input("search","search",docsFilter.q);q.placeholder="Search documents or case reference";q.setAttribute("aria-label","Search documents");const filter=select("status",[["","All stages"],...Object.entries(statuses).filter(([s])=>!["accepted","pending","rejected"].includes(s))],docsFilter.status);const results=E("div");
 const draw=()=>{docsFilter={q:q.value,status:filter.value};const match=d.documents.filter(x=>(!filter.value||x.status===filter.value)&&(!q.value||[x.name,x.case_ref,x.case_type].join(" ").toLowerCase().includes(q.value.toLowerCase())));results.replaceChildren(E("p",match.length+" documents","muted"),table(["Document","Case reference","Request type","Stage","Updated",""],match.map(x=>[btn(x.name,()=>openDoc(x.id),"linkbutton"),x.case_ref,x.case_type,status(x.status),fmt(x.updated),btn("Open",()=>openDoc(x.id))])))};
 q.addEventListener("input",draw);filter.addEventListener("change",draw);root.append(panel(null,C(E("div",null,"toolbar"),q,filter),results));draw();show(root)}
async function detail(id){const d=await api("/api/documents/"+id);if(current!=="detail"||selectedDoc!==id)return;detailData=d;const doc=d.document;const root=E("div");root.append(pageHead(doc.name,doc.case_ref+" / "+doc.case_type,[btn("Back to documents",()=>navigate("documents"))]));
 const top=panel(null,C(E("div",null,"toolbar"),status(doc.status),E("span","Updated "+fmt(doc.updated),"muted")));if(doc.error)top.append(E("p",doc.error,"error"));if(doc.reason)top.append(E("p",doc.reason,"note"));root.append(top);
 const base="/api/documents/"+id;
 if(doc.status==="failed"&&canReview())top.append(btn("Retry processing",action(async()=>{await api(base+"/retry","POST",{});await render()}),"primary"));
 if(doc.status==="released"){const a=E("a","Download redacted PDF");a.href=API_BASE+base+"/download";a.id="download-release";top.append(a)}
 if(!d.pages.length||account.role==="intake"){root.append(panel("Document status",E("p",d.pages.length?"Processing record is available.":"The document is queued or being analysed. A reviewer will receive the processed pages.","muted")));show(root);return}
 const p=d.pages[Math.min(pageIndex,d.pages.length-1)];pageIndex=p.page;const editable=doc.status==="review"&&canReview()&&(!doc.reviewer||doc.reviewer===account.id);
 const approvals=doc.status==="approval"&&canApprove()&&doc.reviewer!==account.id;
 const tabs=E("div",null,"page-tabs");for(const pg of d.pages){const b=btn("Page "+(pg.page+1)+(pg.reviewed?" / checked":""),()=>{pageIndex=pg.page;selectedFinding=null;drawMode=false;render().catch(e=>notify(e.message))},(pg.page===pageIndex?"active ":"")+(pg.reviewed?"checked":""));tabs.append(b)}
 const f=d.findings.filter(x=>x.page===pageIndex);
 const image=E("img");image.src=API_BASE+base+"/page/"+pageIndex;image.alt="Original document page "+(pageIndex+1);image.draggable=false;const stage=C(E("div",null,"page-image"+(drawMode?" drawing":"")),image);stage.id="page-image";
 function showBox(box,cls){const b=E("div",null,cls);const [x,y,w,h]=box;b.style.left=100*x/p.width+"%";b.style.top=100*y/p.height+"%";b.style.width=100*w/p.width+"%";b.style.height=100*h/p.height+"%";return b}
 const findingList=E("div",null,"review-list");
 function highlight(fid){selectedFinding=fid;for(const n of stage.querySelectorAll(".redact-box"))n.classList.toggle("selected",n.dataset.id===fid);for(const n of findingList.children)n.classList.toggle("selected",n.dataset.id===fid)}
 for(const x of f){const b=showBox(x.box,"redact-box "+x.status);b.dataset.id=x.id;b.title=x.label;b.addEventListener("click",()=>{highlight(x.id);findingList.querySelector('[data-id="'+x.id+'"]')?.scrollIntoView({block:"nearest"})});stage.append(b)}
 if(editable){let start=null,temp=null;const coords=e=>{const r=image.getBoundingClientRect();return [Math.max(0,Math.min(p.width,Math.round((e.clientX-r.left)*p.width/r.width))),Math.max(0,Math.min(p.height,Math.round((e.clientY-r.top)*p.height/r.height)))]};
 stage.addEventListener("pointerdown",e=>{if(!drawMode||e.button!==0)return;e.preventDefault();start=coords(e);stage.setPointerCapture(e.pointerId);temp=showBox([start[0],start[1],1,1],"draft-box");stage.append(temp)});
 stage.addEventListener("pointermove",e=>{if(!start)return;const a=coords(e),x=Math.min(a[0],start[0]),y=Math.min(a[1],start[1]),w=Math.abs(a[0]-start[0]),h=Math.abs(a[1]-start[1]);temp.remove();temp=showBox([x,y,w,h],"draft-box");stage.append(temp)});
 stage.addEventListener("pointerup",e=>{if(!start)return;const a=coords(e),box=[Math.min(a[0],start[0]),Math.min(a[1],start[1]),Math.abs(a[0]-start[0]),Math.abs(a[1]-start[1])];start=null;temp.remove();drawMode=false;stage.classList.remove("drawing");if(box[2]<2||box[3]<2)return;
 const reason=E("textarea");reason.name="reason";reason.required=true;
 modal("Manual redaction",form([labelled("Classification",select("label",["Personal information","Health information","Confidential information","Commercial information","Legal privilege","Other"])),labelled("Reason",reason)],"Apply redaction",async fd=>{await api(base+"/findings","POST",{page:pageIndex,box,label:fd.get("label"),reason:fd.get("reason")});await render()}))});
 }
 for(const x of f){const card=E("div",null,"finding");card.dataset.id=x.id;card.append(C(E("div",null,"finding-head"),btn(x.label,()=>highlight(x.id),"linkbutton"),status(x.status)),E("span",x.method,"muted"));if(x.reason)card.append(E("span",x.reason,"small"));if(editable){const decide=async(s,reason="")=>{await api(base+"/findings/"+x.id,"POST",{status:s,reason});selectedFinding=x.id;await render()};card.append(C(E("div",null,"toolbar"),btn("Accept",action(()=>decide("accepted"))),btn("Reject",()=>textPrompt("Reject finding","Reason for retaining this information",r=>decide("rejected",r))),x.status!=="pending"?btn("Reset",action(()=>decide("pending"))):null))}findingList.append(card)}
 if(!f.length)findingList.append(E("div","No automatic findings on this page. Inspect the source before marking it checked.","empty"));
 const left=panel("Document preview",tabs,C(E("div",null,"page-view"),stage));const right=panel("Page "+(pageIndex+1),E("p",f.length+" findings / "+f.filter(x=>x.status==="pending").length+" unresolved","muted"),findingList);
 if(editable){const draw=btn("Draw redaction",()=>{drawMode=!drawMode;stage.classList.toggle("drawing",drawMode);draw.textContent=drawMode?"Cancel drawing":"Draw redaction"});draw.id="draw-redaction";
 const check=btn(p.reviewed?"Page checked":"Mark page checked",action(async()=>{await api(base+"/page/"+pageIndex+"/review","POST",{});await render()}));check.id="check-page";check.disabled=p.reviewed;
 const submit=btn("Submit for approval",action(async()=>{await api(base+"/submit","POST",{});notify("Submitted for independent approval.");await render()}),"primary");submit.id="submit-review";submit.disabled=!d.pages.every(x=>x.reviewed)||d.findings.some(x=>x.status==="pending");right.append(C(E("div",null,"actions"),draw,check,submit))}
 if(approvals){const approve=btn("Approve and release",()=>textPrompt("Approve release","Approval rationale",async r=>{await api(base+"/approval","POST",{decision:"approve",reason:r});await render()}),"primary");approve.id="approve-release";right.append(C(E("div",null,"actions"),approve,btn("Return for review",()=>textPrompt("Return for review","Changes required",async r=>{await api(base+"/approval","POST",{decision:"return",reason:r});await render()}))))}
 if(doc.status==="approval"&&!approvals)right.append(E("p","Independent approval is required before release.","note"));
 root.append(C(E("div",null,"workbench"),left,right));show(root);if(selectedFinding)highlight(selectedFinding)}
async function rulesView(v){const d=await api("/api/rules");if(current!==v)return;const root=E("div");function add(){const l=input("label"),t=input("term");l.required=t.required=true;modal("Add redaction rule",form([labelled("Classification",l),labelled("Text to identify",t)],"Save rule",async fd=>{await api("/api/rules","POST",Object.fromEntries(fd));await render()}))}
 root.append(pageHead("Redaction rules","Custom terms and classifications for incoming documents",isAdmin()?[btn("Add rule",add,"primary")]:[]));root.append(panel("Custom rules",table(["Classification","Text to identify","Created",""],d.rules.map(r=>[r.label,r.term,fmt(r.created),isAdmin()?btn("Remove",action(async()=>{if(confirm("Remove this rule?")){await api("/api/rules/"+r.id,"DELETE");await render()}}),"danger"):""]))),panel("Built-in detection",E("p","Local named-entity recognition, email addresses, telephone numbers, National Insurance numbers, NHS numbers, postcodes, date-of-birth patterns, account details and sensitive information indicators. All findings require human review.","muted")));show(root)}
async function auditView(v){const d=await api("/api/audit");if(current!==v)return;const root=E("div");root.append(pageHead("Audit log","Recorded document and access activity"),panel(null,table(["Time","Actor","Action","Document","Record hash"],d.events.map(r=>[fmt(r.at),r.actor,r.action.replaceAll("_"," "),r.document?btn(r.document.slice(0,8),()=>openDoc(r.document),"linkbutton"):"",E("span",r.digest.slice(0,16),"small")]))));show(root)}
async function usersView(v){const d=await api("/api/users");if(current!==v)return;function add(){const name=input("name"),uid=input("username"),pw=input("password","password");name.required=uid.required=pw.required=true;pw.minLength=14;modal("Add user",form([labelled("Name",name),labelled("Username",uid),labelled("Role",select("role",Object.entries(roles))),labelled("Password (at least 14 characters)",pw)],"Create user",async fd=>{await api("/api/users","POST",Object.fromEntries(fd));await render()}))}show(C(E("div"),pageHead("Users and access","Assign intake, review and approval responsibilities",[btn("Add user",add,"primary")]),panel(null,table(["Name","Username","Role","Status"],d.users.map(u=>[u.name,u.id,roles[u.role],u.active?"Active":"Inactive"])))))}
function integrationView(){const root=E("div");function add(){const n=input("name");n.required=true;const f=form([labelled("Integration name",n)],"Create access token",async fd=>{const d=await api("/api/integrations","POST",Object.fromEntries(fd));setTimeout(()=>modal("Integration access token",C(E("div"),E("p","Store this token securely. It is displayed once."),E("div",d.token,"token"))),100)});modal("New integration",f)}
 root.append(pageHead("Integrations","Document management and case system API",[btn("Create access token",add,"primary")]),panel("API endpoints",E("p","Use a Bearer access token. Upload documents against a case reference, retrieve status and download only approved releases."),table(["Method","Endpoint"],[["POST","/api/integration/v1/documents"],["GET","/api/integration/v1/documents/{id}"],["GET","/api/integration/v1/documents/{id}/download"]])));show(root)}
api("/api/me").then(setAccount).catch(()=>{});
