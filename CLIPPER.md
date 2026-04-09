# Clipper Server Reference

## Server Details

| Property | Value |
|----------|-------|
| **Hostname** | `clipper.speedero.com` |
| **IP** | 54.245.24.178 |
| **Role** | Primary navdata + chartdata server |
| **OS** | SLES 15-SP7 (SUSE Linux Enterprise Server) |
| **Primary User** | `ec2-user` |
| **SSH** | `ssh clipper` (uses ~/.ssh/clipper_ed25519) |
| **Data Path** | `/data/` |
| **Apache** | Port 80 (no TLS configured yet) |
| **Apache DocumentRoot** | `/srv/www/htdocs` |
| **Apache config dir** | `/etc/apache2/` (vhost drop-ins: `/etc/apache2/vhosts.d/*.conf`) |
| **Apache service** | `sudo systemctl {status,reload,restart} apache2` |
| **Module loading** | SLES-style: edit `APACHE_MODULES` in `/etc/sysconfig/apache2`, then `sudo systemctl restart apache2` (there is no `a2enmod`) |

## SSH Access

```bash
ssh clipper
# OR explicitly:
ssh -i ~/.ssh/clipper_ed25519 ec2-user@clipper.speedero.com
```

## Production URLs

- `http://clipper.speedero.com/navdata/...`    — navdata static files
- `http://clipper.speedero.com/chartdata/...`  — chartdata static files
- `http://clipper.speedero.com/VintageRadar/`  — Vintage Radar app
- `http://clipper.speedero.com/info.php`       — PHP info (dev)
- `http://clipper.speedero.com/SecApp` *(planned)* — Speedero Security (Next.js, reverse-proxied to `127.0.0.1:3000`, see `CLIPPER_MIGRATION.md`)

## Directory Structure

```
/srv/www/htdocs/           # Apache DocumentRoot
├── chartdata/             # chart data served statically
├── navdata/               # nav data served statically
├── VintageRadar/          # Vintage Radar app
├── info.php
└── SecApp/                # (planned) Speedero Security Next.js app — see CLIPPER_MIGRATION.md

/etc/apache2/              # Apache config
├── httpd.conf             # main
├── default-server.conf    # DocumentRoot lives here
├── listen.conf
├── ssl-global.conf
└── vhosts.d/              # drop-in vhost configs (*.conf)
    ├── vhost.template
    └── vhost-ssl.template

/data/                     # primary data path (nav/chart source, see Role above)
```

## Troubleshooting

**Check Apache Status:**
```bash
ssh clipper "sudo systemctl status apache2"
```

**Test HTTP Access:**
```bash
curl -I http://clipper.speedero.com/navdata/latest/manifest.json
curl -I http://clipper.speedero.com/chartdata/latest/manifest.json
```