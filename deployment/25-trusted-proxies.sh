#!/bin/sh
# cloudflared 是 web 唯一外部網路，Compose gw_priority 保證其為預設閘道。
# 不讀取 Docker socket、不查詢外部服務，也不信任整個 Internet。
set -eu
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != '--print' ]; }; then
    echo 'proxy_trust: invalid arguments' >&2; exit 1
fi
routes4=$(ip -4 route show) || { echo 'proxy_trust: cannot read IPv4 routes' >&2; exit 1; }
routes6=$(ip -6 route show) || { echo 'proxy_trust: cannot read IPv6 routes' >&2; exit 1; }
config=$(printf '%s\n%s\n%s\n' "$routes4" '--IPV6--' "$routes6" | awk '
function bad() { invalid=1 }
function interface_of(  i) { for(i=2;i<NF;i++) if($i=="dev") return $(i+1); return "" }
function has(word,  i) { for(i=1;i<=NF;i++) if($i==word) return 1; return 0 }
function ipv4_private(cidr,  a,o,n,p,i) {
    if(cidr !~ /^[0-9.]+\/[0-9]+$/) return 0;
    split(cidr,a,"/"); p=a[2]+0; n=split(a[1],o,".");
    if(n!=4 || p<8 || p>32) return 0;
    for(i=1;i<=4;i++) if(o[i]=="" || o[i]+0>255) return 0;
    return o[1]+0==10 || (o[1]+0==172 && o[2]+0>=16 && o[2]+0<=31 && p>=12) || (o[1]+0==192 && o[2]+0==168 && p>=16);
}
$0=="--IPV6--" { v6=1; next }
{ lines[++count]=$0; family[count]=v6 }
!v6 && $1=="default" {
    dev=interface_of();
    if(dev=="" || dev=="lo") bad(); else defaults[dev]=1;
}
END {
    for(dev in defaults) { selected=dev; total++ }
    if(total!=1) { print "proxy_trust: expected exactly one IPv4 gateway interface" > "/dev/stderr"; exit 1 }
    for(row=1;row<=count;row++) {
        $0=lines[row];
        # BusyBox ip 不顯示 proto kernel；以 gateway 介面、無 via 與 link scope 識別直連路由。
        if(interface_of()!=selected || has("via") || $1=="default") continue;
        cidr=$1;
        if(!family[row]) {
            if(!has("link") || !ipv4_private(cidr)) { bad(); continue }
            if(!seen[cidr]++) { output=output "set_real_ip_from " cidr ";\n"; v4count++ }
        } else {
            # Docker 的 IPv6 ULA 直連子網；link-local 不用於 Docker DNS 的服務位址。
            if(tolower(cidr) ~ /^fe80:/) continue;
            if(tolower(cidr) !~ /^f[cd][0-9a-f:]*\/[0-9]+$/) { bad(); continue }
            split(cidr,parts,"/"); if(parts[2]+0<7 || parts[2]+0>128) { bad(); continue }
            if(!seen[cidr]++) output=output "set_real_ip_from " cidr ";\n";
        }
    }
    if(invalid) { print "proxy_trust: unsupported connected subnet on gateway interface " selected > "/dev/stderr"; exit 1 }
    if(!v4count) { print "proxy_trust: no private IPv4 connected subnet on gateway interface " selected > "/dev/stderr"; exit 1 }
    printf "# Generated from the cloudflared network at container startup.\n%s",output;
}') || exit 1
if [ "${1:-}" = '--print' ]; then
    printf '%s\n' "$config"
else
    umask 077
    printf '%s\n' "$config" > /etc/nginx/trusted-proxies.conf
    # 此腳本在官方 20-envsubst 後執行，語法錯誤會阻止 Nginx 啟動。
    nginx -t
    echo 'proxy_trust: cloudflared network configured'
fi
