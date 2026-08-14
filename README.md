# ClickMonkey 2

Rewrite in progress on branch `v2`. ClickMonkey 0.0.7 is tagged.

Point it at a URL. It maps the page, drives it with a line DSL, and uses that same log to reproduce bugs.

0.0.7 configs (`intro` as a WebdriverIO callback, `proxy_port`, JRE) will not run.

```
clickmonkey init --url http://localhost:4173/
clickmonkey inspect
clickmonkey playbook empty-required
clickmonkey replay runs/<id>/replay.log
```

