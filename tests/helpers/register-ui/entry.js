import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {DealerRegisters} from '../../../src/components/dealer-registers';
import {DealForm} from '../../../src/components/deal-form';
import {DealerWorkspace} from '../../../src/components/dealer-workspace';
const root=createRoot(document.getElementById('root'));
const renderRows=page=>React.createElement('div',{className:'table-scroll'},React.createElement('table',{className:'data-table','aria-label':'Verifierade registerrader'},React.createElement('thead',{},React.createElement('tr',{},React.createElement('th',{},'Post'),React.createElement('th',{},'ID'))),React.createElement('tbody',{},...page.rows.map(row=>React.createElement('tr',{key:row.id,'data-row-id':row.id},React.createElement('td',{},row.name??(row.vehicles?row.vehicles.make+' '+row.vehicles.model:row.customer.name)),React.createElement('td',{},row.id))))));
const onCriteriaChange=()=>window.fixture.criteriaChanges++;
const onPage=page=>window.fixture.pages.push(structuredClone(page));
function identity(snapshot){window.fixture.scope={companyId:snapshot.organization.id,actorId:snapshot.user.id,role:snapshot.membership.role};}
window.mountRegisters=props=>{window.fixture.scope={companyId:props.companyId,actorId:props.userId,role:props.role};flushSync(()=>root.render(React.createElement(DealerRegisters,{...props,renderRows,onCriteriaChange,onPage})));};
window.mountDeal=props=>{identity(props.snapshot);flushSync(()=>root.render(React.createElement(DealForm,props)));};
window.mountWorkspace=props=>{identity(props.snapshot);window.fixture.workspaceProps=props;document.getElementById('root').parentElement.className='';document.getElementById('root').parentElement.style.padding='0';const workspace=React.createElement(DealerWorkspace,props);flushSync(()=>root.render(window.fixture.strictMode?React.createElement(React.StrictMode,null,workspace):workspace));};
