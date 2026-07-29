"""Tests for SiteVocab load/merge used by compact coverage."""
from __future__ import annotations

from integrations.browser_use.rulebooks import load_site_vocab


def test_load_site_vocab_merges_generic_and_digital():
    vocab = load_site_vocab()
    assert "generic" in vocab.pack_ids
    assert "digital" in vocab.pack_ids
    assert "cookie_dismiss" in vocab.aliases
    assert "add_to_cart" in vocab.aliases
    assert "search_submit" in vocab.aliases


def test_exclusive_pairs_add_vs_view_cart():
    vocab = load_site_vocab(site_pack="digital")
    assert vocab.exclusive_conflict("add_to_cart", "view_cart")
    assert vocab.exclusive_conflict("language_select", "search_submit")


def test_continue_shopping_aliases_do_not_collide_with_add_to_cart():
    vocab = load_site_vocab()
    cont = vocab.aliases["continue_shopping"]
    add = vocab.aliases["add_to_cart"]
    assert cont.act_matches('click "Continue Shopping"')
    assert not add.act_matches('click "Continue Shopping"')
    assert add.act_matches('click "Add to cart"')
    assert not cont.act_matches('click "Add to cart"')


def test_css_probes_from_digital_pack():
    vocab = load_site_vocab(url="https://www.automationexercise.com/")
    hits = vocab.css_probe_match("#cart_info_table tbody tr")
    assert "cart_rows" in hits
    amazon = vocab.css_probe_match(".s-search-result")
    assert "amazon_results" in amazon


def test_dynamics_vocab_stub():
    vocab = load_site_vocab(site_pack="dynamics365")
    assert "dynamics365" in vocab.pack_ids
    assert "ignore_and_save" in vocab.aliases
    assert vocab.aliases["ignore_and_save"].nl_matches("check for duplicate Ignore and Save")


def test_optional_cookie_intent():
    vocab = load_site_vocab()
    assert vocab.is_optional_intent("cookie_dismiss")
    assert vocab.is_optional_intent("language_select")
    nl = "If a location, cookie, or sign-in dialog blocks the page, dismiss it"
    assert "cookie_dismiss" in vocab.intents_for_nl(nl)
