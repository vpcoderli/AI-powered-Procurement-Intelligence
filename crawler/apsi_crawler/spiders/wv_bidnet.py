from apsi_crawler.spiders.co_bidnet import fetch_bidnet_opportunities


WV_BIDNET_URL = "https://www.bidnetdirect.com/west-virginia/solicitations/open-bids"


def fetch_wv_bidnet_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
):
    return fetch_bidnet_opportunities(
        source,
        url=WV_BIDNET_URL,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
        issuer_name="BidNet West Virginia",
    )
