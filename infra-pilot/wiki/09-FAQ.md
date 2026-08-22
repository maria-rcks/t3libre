# FAQ

**What is Infra Pilot?**
A tool that runs your apps and servers. You use it from the command line, a web page, or Discord.

**Why not just Terraform or Pulumi?**
Infra Pilot works on top of them. It adds AI features, Discord control, energy tracking, and a web interface.

**I get "Connection failed" on `ipilot health`?**
Check `docker compose ps`. Set the correct URL: `ipilot config set api_url http://localhost:3001`.

**Can I run just some services?**
Yes. `docker compose up -d postgres redis`.

**How do I change the output format?**
`ipilot config set output_format json`

**200+ commands — how do I remember them?**
Use `ipilot --help` for the main list. Use `ipilot <command> --help` for details.

**Can I work offline?**
Yes. Use a local AI (Ollama, LM Studio). Set `AI_API_ENDPOINT` in `.env`.

---

*[Issues](https://github.com/drosemann/infra-pilot/issues) · [Discussions](https://github.com/drosemann/infra-pilot/discussions)*
