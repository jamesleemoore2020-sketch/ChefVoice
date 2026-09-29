# Recipe import: the address that was checked is the address connected to (0.5.21 batch)

Audit finding **F30**, in the `chefvoice-import` Cloud Functions codebase only. Committed on
`claude/audit-implementation-2026-09-28-e6a4a5`. **Not deployed yet**: it ships with
`DEPLOY_IMPORT.cmd` (see the end). The PWA, Android, the URL rules, the daily cap and the
callable's request and response are unchanged, so nothing else needs a release.

## The gap

`PWA_RECIPE_IMPORT_0.5.17.md` recorded it rather than leaving it implied. Before each fetch the
function resolved the page's hostname and refused unless every address was public; then `fetch`
resolved the same name again to open the connection. A name whose DNS answers with a public
address to the first question and a private one to the second (DNS rebinding) passed the check
and connected to the private address. Inside Google's network, "private" includes the metadata
server at `169.254.169.254`.

## The fix

The check moved into the connection. `page-fetcher.js` now fetches with undici's own `fetch`
through an undici `Agent` whose sockets resolve their name with `publicOnlyLookup`: it resolves
the name once, refuses unless every address is public, and hands the socket the addresses it
just checked. There is no second lookup to answer differently. TLS still checks the
certificate against the hostname, so fixing the address weakens nothing.

- **undici's own `fetch`, not the global one**, as the audit said: an undici `Agent` handed to
  the `fetch` bundled with a different Node release can disagree with it about the dispatcher
  interface. `undici` 7.30.0 is pinned exactly, like the codebase's other two dependencies, and
  supports every Node 22 the Functions runtime can be on (it needs 20.18.1 or later; undici 8
  would need 22.19).
- **The separate pre-check is gone.** It gave no protection the connection's own check does not,
  and keeping two checks invited the belief that the first one mattered.
- **What the chef sees is unchanged**: a refused address still reads "That address isn't a public
  web page ChefVoice can import from", and a name that does not resolve still reads "ChefVoice
  couldn't reach that site". The refusal travels inside fetch's own error, and is unwrapped.

## IPv6, stricter

`isPublicAddress` now puts every IPv6 address into one spelling first (`::ffff:7f00:1` and
`::ffff:127.0.0.1` are one address), and accepts only global unicast, `2000::/3`. That refuses,
besides what it refused before: **NAT64** (`64:ff9b::/96` and `64:ff9b:1::/48`, which reach
whatever IPv4 address they carry, the metadata server included), **multicast** (`ff00::/8`),
discard-only (`100::/64`) and the deprecated IPv4-compatible form. Inside `2000::/3` it refuses
**6to4** (`2002::/16`, another wrapped IPv4 address), the IETF protocol block `2001::/23`
(**Teredo** among them) and documentation (`2001:db8::/32`). IPv4-mapped addresses are still
judged by the IPv4 address inside them, now in either spelling.

## Tests

Import **102 / 0** (98 before). The three tests of the old pre-check were replaced by five that
run the production fetch over **real sockets**, against a page server on `127.0.0.1` with the
name's answers supplied by the test:

- the connection goes to the address the lookup checked, and the name is resolved **once**, by
  the connection: a second, private answer scripted for a later lookup is never asked for;
- a name that resolves to `169.254.169.254` never opens a connection, and neither does one with a
  private address among public ones;
- a name that does not resolve is reported as unreachable;
- and with the real rule, a name pointing at this machine is refused.

Two more are new: the lookup answers in both shapes `net.connect` asks for (all addresses, or
one), and the IPv6 ranges above. Breaking the fetcher ten ways (no dispatcher, a lookup
that allows anything or only needs one good address, the refusal not unwrapped, one answer shape
only, and each IPv6 rule and the canonical spelling) was caught every time. One of those shows the
socket really uses the lookup: answering with a single address when `net.connect` asked for all
of them broke a real connection.

**CI and the gate script install the codebase's dependencies first**, because the fetch tests
need undici: `.github/workflows/gates.yml` runs `npm ci` in `import/functions`, and
`RUN_IMPORT_GATES.cmd` does the same when `node_modules` has no undici yet.

## To release

`DEPLOY_IMPORT.cmd` deploys only the `chefvoice-import` codebase and runs the import gates first,
which install the dependencies on first use. Then import any real recipe page from the PWA as a
signed-in chef (the 0.5.17 check used bbcgoodfood.com). It should import exactly as before. The
private-address cases cannot be tried from outside, which is why they are tested over real sockets
here.

Not done here: the Android importer runs on the phone and checks hostnames only, not what they
resolve to. There, a name pointing at `192.168.x.x` reaches the chef's own network, and the
result is only ever shown to that chef. The audit did not raise it; it is noted for completeness.
