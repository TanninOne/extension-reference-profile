import memoize from 'memoize-one';
import * as path from 'path';
import { OptionsFilter, selectors, types, util, actions } from 'vortex-api';

type IModWithState = types.IMod & types.IProfileMod;

const referenceProfile = memoize((state: types.IState): types.IProfile => {
    const profile = selectors.activeProfile(state);
    const refProfId = profile?.features?.reference_profile;
    if (refProfId === undefined) {
        return undefined;
    }
    return selectors.profileById(state, refProfId)
});

function modState(api: types.IExtensionApi, mod: IModWithState) {
    if (mod.state === 'downloaded') {
        return (mod.attributes?.wasInstalled !== undefined)
            ? 'Uninstalled'
            : 'Never Installed';
    } else if (mod.state === 'installing') {
        return 'Installing';
    }

    const refProfile = referenceProfile(api.getState());

    if (refProfile === undefined) {
        return 'N/A';
    }

    return refProfile?.modState?.[mod.id]?.enabled
        ? 'Enabled'
        : 'Disabled';
}

function onChangeEnabled(api: types.IExtensionApi, mods: IModWithState | IModWithState[], value: any) {
    if (Array.isArray(mods)) {
        mods.forEach(mod => changeModEnabled(api, mod, value));
    } else {
        changeModEnabled(api, mods, value);
    }
}

function changeModEnabled(api: types.IExtensionApi, mod: IModWithState, value: any) {
    if (['installing', undefined].includes(mod.state)) {
        // can't change state while installing
        return;
    }

    const refProfile = referenceProfile(api.getState());
    if (refProfile === undefined) {
        return;
    }
    if (value === undefined) {
        // toggle clicked

        if (mod.state === 'downloaded') {
            // install
            api.events.emit('start-install-download', mod.id);
        } else {
            // toggle between enabled/disabled
            const currentState: boolean = refProfile.modState?.[mod.id]?.enabled === true;
            api.store.dispatch(actions.setModEnabled(refProfile.id, mod.id, !currentState));
        }
    } else {
        // enabled or disabled selected from dropdown
        const enabled = value === 'enabled';
        api.store.dispatch(actions.setModEnabled(refProfile.id, mod.id, enabled));
    }
}

function makeStatusAttribute(api: types.IExtensionApi,
                             setOnChange: (changeCB: () => void) => void): types.ITableAttribute<IModWithState> {
    return {
        id: 'ref-profile-enabled',
        name: 'Reference Status',
        description: 'Is mod enabled in reference profile',
        icon: 'check-o',
        position: 25,
        calc: (mod: IModWithState) => modState(api, mod),
        placement: 'table',
        isToggleable: true,
        edit: {
            inline: true,
            choices: () => [
                { key: 'enabled', text: 'Enabled', icon: 'toggle-enabled' },
                { key: 'disabled', text: 'Disabled', icon: 'toggle-disabled' },
                { key: 'uninstalled', text: 'Uninstalled', icon: 'toggle-uninstalled', disabled: true },
                { key: 'noprofile', text: 'N/A', icon: 'not-available', disabled: true },
            ],
            onChangeValue: (objects, newValue) => onChangeEnabled(api, objects, newValue),
        },
        noShrink: true,
        isSortable: false,
        isGroupable: true,
        filter: new OptionsFilter([
            { value: 'Enabled', label: 'Enabled' },
            { value: 'Disabled', label: 'Disabled' },
            { value: 'Uninstalled', label: 'Uninstalled' },
        ], true, false),
        externalData: (onChange: () => void) => { setOnChange(onChange) },
    } as any;
}

function makeOnSelectReferenceProfile(api: types.IExtensionApi) {
    return (baseProfileIds: string[]) => {
        const state = api.getState();
        const profile: types.IProfile = selectors.profileById(state, baseProfileIds[0]);
        const refProfId = profile.features?.reference_profile;
        const profiles: types.IProfile[] =
            selectors.gameProfiles(state, profile.gameId)
            .filter(prof => prof.id !== profile.id);
        api.showDialog('question', 'Select Reference Profile', {
            text: 'Please select another profile that should serve as a reference to compare against. '
                + 'Remember that you have to enable the "Reference Status" column on the mods table '
                + 'to see anything.',
            choices: [
                { id: '__none', text: 'None', value: refProfId === undefined },
            ].concat(
                profiles.map(prof => ({ id: prof.id, text: prof.name, value: prof.id === refProfId }))
            ),
        }, [
            { label: 'Cancel' },
            { label: 'Continue' },
        ])
        .then((result: types.IDialogResult) => {
            if (result.action === 'Continue') {
                const pick = Object.keys(result.input).find(profId => result.input[profId]);
                if (pick !== undefined) {
                    api.store.dispatch(actions.setFeature(profile.id, 'reference_profile', pick === '__none' ? undefined : pick));
                }
            }
        });
    };
}

function init(context: types.IExtensionContext) {
    let onChange: () => void;
    context.registerProfileFeature(
        'reference_profile', 'string', 'reference', 'Reference',
        'Reference Profile', () => true);

    context.registerTableAttribute('mods', makeStatusAttribute(context.api, (onChangeIn) => { onChange = onChangeIn }));
    context.registerAction('profile-actions', 150, 'deploy', {}, 'Set Reference Profile',
        makeOnSelectReferenceProfile(context.api));

    context.once(() => {
        context.api.setStylesheet('ref-profile', path.join(__dirname, 'style.scss'));
        context.api.onStateChange(['persistent', 'profiles'], (prev: { [profId: string]: types.IProfile }, cur: { [profId: string]: types.IProfile }) => {
            const state = context.api.getState();
            const profile = selectors.activeProfile(state);
            const refProfile = referenceProfile(state);
            if ((refProfile !== undefined)
                && (prev[refProfile.id].modState !== cur[refProfile.id].modState)) {
                onChange?.();
            } else if ((profile !== undefined)
                && (prev[profile.id]?.features !== cur[profile.id]?.features)) {
                onChange?.();
            }
        });
    });

    return true;
}

export default init;
