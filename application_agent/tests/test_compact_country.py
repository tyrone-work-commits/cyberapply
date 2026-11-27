import pytest

from application_agent.reasoning import build_plan
from application_agent.tests.test_browser import PAYLOAD,FORM,run


def compact_country(tamper=''):
    return FORM.replace('{extra}',r'''<label for="country">Country</label>
      <div><div><span id="selected-code"></span><input role="combobox" id="country" aria-required="true" aria-expanded="false" aria-controls="countries"></div></div>
      <div id="countries" role="listbox" hidden></div><input name="country_answer" type="hidden">
      <script>const combo=document.getElementById('country'),menu=document.getElementById('countries');let chosen='';
      combo.onclick=()=>{menu.replaceChildren();for(const name of ['United States +1','Canada +1']){
        const item=document.createElement('div');item.role='option';item.textContent=name;item.setAttribute('aria-selected',String(chosen===name));
        item.onclick=()=>{chosen=name;document.getElementById('selected-code').textContent='+ 1';combo.value='';combo.setAttribute('aria-expanded','false');menu.hidden=true;
          document.querySelector('[name=country_answer]').value=name;TAMPER};menu.append(item);}
        combo.setAttribute('aria-expanded','true');menu.hidden=false;};
      combo.onkeydown=event=>{if(event.key==='Escape'){menu.hidden=true;combo.setAttribute('aria-expanded','false');}};</script>'''.replace('TAMPER',tamper))


def test_compact_code_is_verified_against_exact_selected_country():
    result,posts=run(compact_country(),payload={**PAYLOAD,'applicantProfile':{'country':'USA'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1 and b'United States +1' in posts[0],result
    assert any(a.get('selected_option')=='United States +1' for a in result['report']['answers'])


@pytest.mark.parametrize('tamper',[
    "chosen='Canada +1';",  # Same calling code is not the same country.
    "chosen='';",  # Displayed/typed code alone proves nothing.
    "combo.setAttribute('aria-invalid','true');",
])
def test_compact_display_never_hides_an_unconfirmed_country(tamper):
    result,posts=run(compact_country(tamper),payload={**PAYLOAD,'applicantProfile':{'country':'USA'}},planner=build_plan)
    assert result['status']=='needs_attention' and not posts and 'receipt' not in result,result


def test_compact_country_dry_run_still_cannot_submit():
    result,posts=run(compact_country(),payload={**PAYLOAD,'applicantProfile':{'country':'USA'}},planner=build_plan,submit=False)
    assert 'Dry run' in result['message'] and not posts,result
