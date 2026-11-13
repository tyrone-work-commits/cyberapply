from application_agent.reasoning import build_plan
from application_agent.tests.test_browser import PAYLOAD,run
from application_agent.tests.test_combobox import dropdowns
from application_agent.tests.test_compact_country import compact_country


def test_keyboard_opening_recovers_from_pointer_overlay_without_guessing():
    script="""const root=document.getElementById('field0'),combo=root.querySelector('[role=combobox]');
    root.querySelector('.control').style.position='relative';const cover=document.createElement('div');
    cover.style.cssText='position:absolute;inset:0;z-index:10';root.querySelector('.control').append(cover);
    combo.addEventListener('keydown',event=>{if(event.key==='ArrowDown')combo.click();});"""
    result,posts=run(dropdowns([{'label':'Country','options':['Nigeria','United States']}],script),payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1 and b'Nigeria' in posts[0],result


def test_compact_country_can_reopen_by_keyboard_and_still_verify_exact_country():
    html=compact_country().replace("if(event.key==='Escape')", "if(event.key==='ArrowDown')combo.click();if(event.key==='Escape')")
    html=html.replace('</script>',"""combo.parentElement.style.position='relative';const cover=document.createElement('div');
    cover.style.cssText='position:absolute;inset:0;z-index:10';combo.parentElement.append(cover);</script>""")
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'country':'USA'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1 and b'United States +1' in posts[0],result
