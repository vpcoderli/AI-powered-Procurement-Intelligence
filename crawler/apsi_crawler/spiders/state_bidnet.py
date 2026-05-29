from apsi_crawler.spiders.co_bidnet import fetch_bidnet_opportunities


BIDNET_STATE_URLS = {
    "al_state_procurement": "https://www.bidnetdirect.com/alabama/solicitations/open-bids",
    "ak_state_procurement": "https://www.bidnetdirect.com/alaska/solicitations/open-bids",
    "ky_state_procurement": "https://www.bidnetdirect.com/kentucky/solicitations/open-bids",
    "mn_state_procurement": "https://www.bidnetdirect.com/minnesota/solicitations/open-bids",
    "wi_state_procurement": "https://www.bidnetdirect.com/wisconsin/solicitations/open-bids",
    "nh_state_procurement": "https://www.bidnetdirect.com/new-hampshire/solicitations/open-bids",
}


def _fetch_state_bidnet(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    url = BIDNET_STATE_URLS[source.id]
    return fetch_bidnet_opportunities(
        source,
        url=url,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
        issuer_name=f"BidNet {source.state_code}",
    )


def fetch_al_bidnet_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    return _fetch_state_bidnet(
        source,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
    )


def fetch_ak_bidnet_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    return _fetch_state_bidnet(
        source,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
    )


def fetch_ky_bidnet_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    return _fetch_state_bidnet(
        source,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
    )


def fetch_mn_bidnet_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    return _fetch_state_bidnet(
        source,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
    )


def fetch_wi_bidnet_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    return _fetch_state_bidnet(
        source,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
    )


def fetch_nh_bidnet_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    return _fetch_state_bidnet(
        source,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
    )
