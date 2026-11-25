# Domain release
Product frontend: https://redaction.suaveforge.com
Dedicated application API and standalone authenticated interface: https://api-redaction.suaveforge.com:19447
No changes to the existing port 80/443 shared gateway or Caddy.
Pages site creation by the GitHub Actions token failed with HTTP 403 in run 45590807592. The repository administrator needs to enable Pages using GitHub Actions and bind the custom domain in Settings > Pages. The deployment workflow verifies the binding and only then creates a new Redaction CNAME with conflict checking. It must not point an unclaimed hostname at Pages. No DNS records for other products are modified.
