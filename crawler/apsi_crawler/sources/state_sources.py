from apsi_crawler.sources.base import Source
from apsi_crawler.spiders.state_fixture import load_state_fixture_opportunities


STATE_SOURCES = {
    "ca_caleprocure": Source(
        id="ca_caleprocure",
        name="California Cal eProcure",
        source_label="California Cal eProcure",
        jurisdiction="state",
        state_code="CA",
        fixture_loader=load_state_fixture_opportunities,
    ),
    "tx_esbd": Source(
        id="tx_esbd",
        name="Texas ESBD",
        source_label="Texas ESBD",
        jurisdiction="state",
        state_code="TX",
        fixture_loader=load_state_fixture_opportunities,
    ),
    "ny_contract_reporter": Source(
        id="ny_contract_reporter",
        name="New York State Contract Reporter",
        source_label="New York State Contract Reporter",
        jurisdiction="state",
        state_code="NY",
        fixture_loader=load_state_fixture_opportunities,
    ),
    "fl_mfmp": Source(
        id="fl_mfmp",
        name="MyFloridaMarketPlace",
        source_label="MyFloridaMarketPlace",
        jurisdiction="state",
        state_code="FL",
        fixture_loader=load_state_fixture_opportunities,
    ),
    "il_bidbuy": Source(
        id="il_bidbuy",
        name="Illinois BidBuy",
        source_label="Illinois BidBuy",
        jurisdiction="state",
        state_code="IL",
        fixture_loader=load_state_fixture_opportunities,
    ),
}
