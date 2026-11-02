from application_agent.tests.test_browser import run
from application_agent.tests.test_combobox import dropdowns
from application_agent.reasoning import build_plan


def test_unknown_choices_are_saved_without_selecting_or_submitting():
    result,posts=run(dropdowns([{'label':'Preferred shift?','options':['Day','Night']}]),planner=build_plan)
    assert result['status']=='needs_attention' and not posts
    question=next(q for q in result['report']['questions'] if q['question']=='Preferred shift?')
    assert question['options']==['Day','Night']
    assert not any(a['question']=='Preferred shift?' for a in result['report']['answers'])


def test_captured_human_options_remain_a_verification_pause():
    result,posts=run(dropdowns([{'label':'Which best describes you?','options':['I am an AI, bot, or automated program.','I am a human.']}]),planner=build_plan)
    assert result['status']=='needs_attention' and not posts
    question=next(q for q in result['report']['questions'] if q['question']=='Which best describes you?')
    assert len(question['options'])==2
    assert not any(a['question']=='Which best describes you?' for a in result['report']['answers'])
