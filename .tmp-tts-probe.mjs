
import { createHash } from "node:crypto";
const slug = "2026-11-01-wo-chi-wan-fan-jiu-lai-zhao-ni-wan";
const html = await (await fetch("https://134688.xyz/post/"+slug+"/")).text();
function de(v){return v.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");}
function ex(h){const m=h.match(/<article\b[^>]*id=["']article-content["'][^>]*>([\s\S]*?)<\/article>/i);if(!m)return "";return de(m[1].replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<([a-z0-9]+)\b[^>]*class=["'][^"']*\bnot-prose\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|div|li|h[1-6]|blockquote|pre|section|ul|ol|table|tr)>/gi,"\n").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();}
function sp(t,max=300){const p=[];let rest=t;while(rest.length>max){let cut=max;const c=rest.slice(0,max);const s=Math.max(c.lastIndexOf("。"),c.lastIndexOf("！"),c.lastIndexOf("？"),c.lastIndexOf("\n"));if(s>max*0.4)cut=s+1;p.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}if(rest.trim())p.push(rest.trim());return p;}
const parts = sp(ex(html));
const id = "post-" + createHash("sha256").update(slug).digest("hex").slice(0,24) + "-0";
const r = await fetch("https://134688.xyz/api/tts?id="+id+"&slug="+encodeURIComponent(slug)+"&text="+encodeURIComponent(parts[0]));
console.log("STATUS", r.status, await r.text());
